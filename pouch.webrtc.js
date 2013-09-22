/*globals Pouch: true, call: false, ajax: true */
/*globals require: false, console: false */

"use strict";


/*
    Design questions:
    - method of sharing databases
    - method of connecting to database
    - peer URL includes hub? "rtc://hub/peer"
    - expose shares via presence or on connect?
    - presence for peers or presence for databases?
    - role of hub apart from signalling, i.e. presence
    - handling of remote procedure stuff
    - handling of security/permissions/validation
    
    Options:
    - expose presence/connections controller to user (current code, ±)
    - hide all connections setup, expose only via adapter (for connecting) and plugin (for sharing)
*/

// a couple additional errors we use
Pouch.Errors.NOT_IMPLEMENTED = {status:501, error:'not_implemented', reason:"Unable to fulfill the request"};       // [really for METHODs only?]
Pouch.Errors.FORBIDDEN = {status:403, error:'forbidden', reason:"The request was refused"};


// Implements the API for dealing with a PouchDB peer's database over WebRTC
var PeerPouch = function(opts, callback) {
    function TODO(callback) {
        // TODO: callers of this function want implementations
        if (callback) setTimeout(function () { callback(Pouch.Errors.NOT_IMPLEMENTED); }, 0);
    }
    
    var _init = PeerPouch._shareInitializersByName[opts.name];
    if (!_init) throw Error("Unknown PeerPouch share dbname");      // TODO: use callback instead?
    
    var handler = _init(function (e,d) {
        console.log("_share.initiateHandler result", e,d);
        TODO(callback);
    });
    
    // Our concrete adapter implementations and any additional public api
    var api = {};
    
    handler.onconnection = function () {
        if (callback) callback(null, api);
        handler.sendMessage("SYN");
    };
    handler.onreceivemessage = function receiveMessage(evt) {
        // TODO: RPC stuff!
        console.log("Telegram, noble peer", evt.data);
        if (evt.data.length < 1000) handler.sendMessage("YAK "+evt.data);
    };
    
    // Use the peer's ID (prefixed?)
    api._id = function() {
        // TODO: implement for realsies
        return Math.random().toFixed(16).slice(2);
    };
    
    // Let our users send arbitrary chatter since we have a connection anyway
    // (We'll likely use this internally for our own communications too)
    api.message = function(options, callback) {
        TODO(callback);         // we'll also want a way to listen for messages back
    };
    
    
    // Concrete implementations of abstract adapter methods
    
    // TODO: update this with latest (e.g. _getRevisionTree, _removeDocRevisions)
    
    // these should be implemented as very generic simple RPC-type stuff
    // for now don't allow *any* remote code execution — eventually optimize map/reduce to happen in WebWorker but, until then,
    // instead use dNode-style (IIRC) trick of serializing functions as an ID and then executing back locally when called on remote
    // (how to handle synchronous map/reduce functions?)
    
    api._info = function(callback) {
        TODO(callback);
    };
    api._get = function(id, opts, callback) {
        TODO(callback);
    };
    api._getAttachment = function (id, opts, callback) {
        TODO(callback);
    };
    api._allDocs = function(opts, callback) {
        TODO(callback);
    };
    api._bulkDocs = function(req, opts, callback) {
        TODO(callback);
    };
    api._changes = function(opts) {
        TODO(callback);
    };
    api._close = function(callback) {
        TODO(callback);
    };
    api._info = function(callback) {
        TODO(callback);
    };
    
    api._id = function() {
        // TODO: implement for realsies using the peer's ID and any other necessary info
        return Math.random().toFixed(16).slice(2);
    };
    
    // TODO: add appropriate support for plugins (query/spatial/etc.)
    
    return api;
};

// Don't bother letting peers nuke each others' databases
PeerPouch.destroy = function(name, callback) {
    if (callback) setTimeout(function () { callback(Pouch.Errors.FORBIDDEN); }, 0);
};

// Can we breathe in this environment?
PeerPouch.valid = function() {
    // TODO: check for WebRTC+DataConnection support
    return true;
};


PeerPouch._types = {
    presence: 'com.stemstorage.peerpouch.presence',
    signal: 'com.stemstorage.peerpouch.signal',
    share: 'com.stemstorage.peerpouch.share'
}
var _t = PeerPouch._types;         // local alias for brevitation…

// Register for our scheme
Pouch.adapter('webrtc', PeerPouch);


var RTCPeerConnection = window.mozRTCPeerConnection || window.RTCPeerConnection || window.webkitRTCPeerConnection,
    RTCSessionDescription = window.mozRTCSessionDescription || window.RTCSessionDescription || window.webkitRTCSessionDescription,
    RTCIceCandidate = window.mozRTCIceCandidate || window.RTCIceCandidate || window.webkitRTCIceCandidate;

function PeerConnectionHandler(opts) {
    var cfg = {"iceServers":[{"url":"stun:23.21.150.121"}]},
        con = { 'optional': [{'DtlsSrtpKeyAgreement': true}, {'RtpDataChannels': true }] };

    this._rtc = new RTCPeerConnection(cfg, con);
    
    this.LOG_SELF = opts._self;
    this.LOG_PEER = opts._peer;
    this._channel = null;
    
    this.onhavesignal = null;       // caller MUST provide this
    this.onreceivemessage = null;   // caller SHOULD provide this
    this.onconnection = null;       // …and maybe this
    
    var handler = this, rtc = this._rtc;
    if (opts.initiate) this._setupChannel();
    else rtc.ondatachannel = this._setupChannel.bind(this);
    rtc.onnegotiationneeded = function (evt) {
        console.log(handler.LOG_SELF, "saw negotiation trigger and will create an offer");
        rtc.createOffer(function (offerDesc) {
            console.log(handler.LOG_SELF, "created offer, sending to", handler.LOG_PEER);
            rtc.setLocalDescription(offerDesc);
            handler._sendSignal(offerDesc);
        }, function (e) { console.warn(handler.LOG_SELF, "failed to create offer", e); });
    };
    rtc.onicecandidate = function (evt) {
        if (evt.candidate) handler._sendSignal({candidate:evt.candidate});
    };
    // debugging
    rtc.onicechange = function (evt) {
        console.log(handler.LOG_SELF, "ICE change", rtc.iceGatheringState, rtc.iceConnectionState);
    };
    rtc.onstatechange = function (evt) {
        console.log(handler.LOG_SELF, "State change", rtc.signalingState, rtc.readyState)
    };
}

PeerConnectionHandler.prototype._sendSignal = function (data) {
    if (!this.onhavesignal) throw Error("Need to send message but `onhavesignal` handler is not set.");
    this.onhavesignal({target:this, signal:JSON.parse(JSON.stringify(data))});
};

PeerConnectionHandler.prototype.receiveSignal = function (data) {
    var handler = this, rtc = this._rtc;
    console.log(this.LOG_SELF, "got data", data, "from", this.LOG_PEER);
    if (data.sdp) rtc.setRemoteDescription(new RTCSessionDescription(data), function () {
        var needsAnswer = (rtc.remoteDescription.type == 'offer');
        console.log(handler.LOG_SELF, "set offer, now creating answer:", needsAnswer);
        if (needsAnswer) rtc.createAnswer(function (answerDesc) {
            console.log(handler.LOG_SELF, "got anwer, sending back to", handler.LOG_PEER);
            rtc.setLocalDescription(answerDesc);
            handler._sendSignal(answerDesc);
        }, function (e) { console.warn(handler.LOG_SELF, "couldn't create answer", e); });
    }, function (e) { console.warn(handler.LOG_SELF, "couldn't set remote description", e) });
    else if (data.candidate) rtc.addIceCandidate(new RTCIceCandidate(data.candidate));
};

PeerConnectionHandler.prototype.sendMessage = function (data) {
    if (!this._channel || this._channel.readyState !== 'open') throw Error("Connection exists, but data channel is not open.");
    console.log("Attempting message send of length", data.length);
    this._channel.send(data);
};

PeerConnectionHandler.prototype._setupChannel = function (evt) {
    var handler = this, rtc = this._rtc;
    if (evt) console.log(this.LOG_SELF, "received data channel", evt.channel.readyState);
    this._channel = (evt) ? evt.channel : rtc.createDataChannel('peerpouch-dev');
    this._channel.onopen = function (evt) {
        console.log(handler.LOG_SELF, "DATA CHANNEL IS OPEN");
        if (handler.onconnection) handler.onconnection(handler._channel);        // BOOM!
    };
    this._channel.onmessage = function (evt) {
        console.log(handler.LOG_SELF, "received message!", evt);
        if (handler.onreceivemessage) handler.onreceivemessage({target:handler, data:evt.data});
    };
    if (window.mozRTCPeerConnection) setTimeout(function () {
        rtc.onnegotiationneeded();     // FF doesn't trigger this for us like Chrome does
    }, 0);
    window.dbgChannel = this._channel;
}


var SharePouch = function (hub) {
    // NOTE: this plugin's methods are intended for use only on a **hub** database
    
    // this chunk of code manages a combined _changes listener on hub for any share/signal(/etc.) watchers
    var watcherCount = 0,         // easier to refcount than re-count!
        watchersByType = Object.create(null),
        changesListener = null;
    function addWatcher(type, cb) {
        var watchers = watchersByType[type] || (watchersByType[type] = []);
        watchers.push(cb);
        watcherCount += 1;
        if (watcherCount > 0 && !changesListener) {         // start listening for changes (at current sequence)
            var cancelListen = false;
            changesListener = {
                cancel: function () { cancelListen = true; }
            };
            hub.info(function (e,d) {
                if (e) throw e;
                var opts = {
                    //filter: _t.ddoc_name+'/signalling',             // see https://github.com/daleharvey/pouchdb/issues/525
                    include_docs: true,
                    continuous:true,
                    since:d.update_seq
                };
                opts.onChange = function (d) {
                    var watchers = watchersByType[d.doc.type];
                    if (watchers) watchers.forEach(function (cb) { cb(d.doc); });
                };
                if (!cancelListen) changesListener = hub.changes(opts);
                else changesListener = null;
            });
        }
        return {cancel: function () { removeWatcher(type, cb); }};
    }
    function removeWatcher(type, cb) {
        var watchers = watchersByType[type],
            cbIdx = (watchers) ? watchers.indexOf(cb) : -1;
        if (~cbIdx) {
            watchers.splice(cbIdx, 1);
            watcherCount -= 1;
        }
        if (watcherCount < 1 && changesListener) {
            changesListener.cancel();
            changesListener = null;
        }
    }
    
    var sharesByRemoteId = Object.create(null),         // ._id of share doc
        sharesByLocalId = Object.create(null);            // .id() of database
    function share(db, opts, cb) {
        if (typeof opts === 'function') {
            cb = opts;
            opts = {};
        } else opts || (opts = {});
        
        var share = {
            _id: 'share-'+Pouch.uuid(),
            type: _t.share,
            name: opts.name || null,
            info: opts.info || null
        };
        hub.post(share, function (e,d) {
            if (!e) share._rev = d.rev;
            if (cb) cb(e,d);
        });
        
        var peerHandlers = Object.create(null);
        share._signalWatcher = addWatcher(_t.signal, function receiveSignal(signal) {
            if (signal.recipient !== share._id) return;
            
            var self = share._id, peer = signal.sender,
                handler = peerHandlers[peer];
            if (!handler) {
                handler = peerHandlers[peer] = new PeerConnectionHandler({initiate:false, _self:self, _peer:peer});
                handler.onhavesignal = function sendSignal(evt) {
                    hub.post({_id:'s-signal-'+Pouch.uuid(), type:_t.signal, sender:self, recipient:peer, data:evt.signal}, function (e) { if (e) throw e; });
                };
                handler.onreceivemessage = function receiveMessage(evt) {
                    console.log("Telegram, sir", evt.data);
                    if (evt.data.length < 1000) handler.sendMessage("ACK "+evt.data);
                    // TODO: *alllllll* the RPC stuff ;-)
                };
            }
            handler.receiveSignal(signal.data);
        });
        sharesByRemoteId[share._id] = sharesByLocalId[db.id()] = share;
    }
    function unshare(db, cb) {            // TODO: call this automatically from _delete hook whenever it sees a previously shared db?
        var share = sharesByLocalId[db.id()];
        hub.post({_id:share._id,_rev:share._rev,_deleted:true}, cb);
        share._signalWatcher.cancel();
        delete sharesByRemoteId[share._id];
        delete sharesByLocalId[db.id()];
    }
    
    function _localizeShare(doc) {
        var name = [hub.id(),doc._id].map(encodeURIComponent).join('/');
        if (doc._deleted) delete PeerPouch._shareInitializersByName[name];
        else PeerPouch._shareInitializersByName[name] = function () {
            var client = 'peer-'+Pouch.uuid(), share = doc._id,
                handler = new PeerConnectionHandler({initiate:true, _self:client, _peer:share});
            handler.onhavesignal = function sendSignal(evt) {
                hub.post({_id:'p-signal-'+Pouch.uuid(), type:_t.signal, sender:client, recipient:share, data:evt.signal}, function (e) { if (e) throw e; });
            };
            addWatcher(_t.signal, function receiveSignal(signal) {
                if (signal.recipient === client && signal.sender === share) handler.receiveSignal(signal.data);
            });
            return handler;     /* for .onreceivemessage and .sendMessage use */
        };
        doc.dbname = 'webrtc://'+name;
        return doc;
    }
    
    function getShares(opts, cb) {
        if (typeof opts === 'function') {
            cb = opts;
            opts = {};
        }
        opts || (opts = {});
        //hub.query(_t.ddoc_name+'/shares', {include_docs:true}, function (e, d) {
        hub.allDocs({include_docs:true}, function (e,d) {
            if (e) cb(e);
            else cb(null, d.rows.filter(function (r) { return !(r.doc._id in sharesByRemoteId); }).map(function (r) { return _localizeShare(r.doc); }));
        });
        if (opts.onChange) {            // WARNING/TODO: listener may get changes before cb returns initial list!
            return addWatcher(_t.share, function (doc) { if (!(doc._id in sharesByRemoteId)) opts.onChange(_localizeShare(doc)); });
        }
    }
    
    return {shareDatabase:share, unshareDatabase:unshare, getSharedDatabases:getShares};
}

PeerPouch._shareInitializersByName = Object.create(null);           // global connection between new PeerPouch (client) and source SharePouch (hub)

SharePouch._delete = function () {};            // blindly called by Pouch.destroy


Pouch.plugin('hub', SharePouch);



Pouch.dbgPeerPouch = PeerPouch;