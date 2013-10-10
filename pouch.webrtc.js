/*globals Pouch: true, call: false, ajax: true */
/*globals require: false, console: false */

"use strict";

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
    
    var api = {};       // initialized later, but Pouch makes us return this before it's ready
    
    handler.onconnection = function () {
        var rpc = new RPCHandler(handler._tube());
        rpc.onbootstrap = function (d) {      // share will bootstrap
            var rpcAPI = d.api;
            
            // simply hook up each [proxied] remote method as our own local implementation
            Object.keys(rpcAPI).forEach(function (k) { api[k]= rpcAPI[k]; });
            
            // one override to provide a synchronous `.cancel()` helper locally
            api._changes = function (opts) {
                if (opts.onChange) opts.onChange._keep_exposed = true;      // otherwise the RPC mechanism tosses after one use
                var cancelRemotely = null,
                    cancelledLocally = false; 
                rpcAPI._changes(opts, function (rpcCancel) {
                    if (cancelledLocally) rpcCancel();
                    else cancelRemotely = rpcCancel;
                });
                return {cancel:function () {
                    if (cancelRemotely) cancelRemotely();
                    else cancelledLocally = true;
                    if (opts.onChange) delete opts.onChange._keep_exposed;  // allow for slight chance of cleanup [if called again]
                }};
            };
            
            api._id = function () {
                // TODO: does this need to be "mangled" to distinguish it from the real copy?
                //       [it seems unnecessary: a replication with "api" is a replication with "rpcAPI"]
                return rpcAPI._id;
            };
            
            // now our api object is *actually* ready for use
            if (callback) callback(null, api);
            
            // TODO: test code, remove at some point
            d.echo("Hello, World!", function (msg) {
                console.log("ECHO", msg);
            });
        };
    };
    
    return api;
};

PeerPouch._wrappedAPI = function (db) {
    /*
        This object will be sent over to the remote peer. So, all methods on it must be:
        - async-only (all "communication" must be via callback, not exceptions or return values)
        - secure (peer could provide untoward arguments)
    */
    var rpcAPI = {};
    
    
    /*
        This lists the core "customApi" methods that are expected by pouch.adapter.js
    */
    var methods = ['bulkDocs', '_getRevisionTree', '_doCompaction', '_get', '_getAttachment', '_allDocs', '_changes', '_close', '_info', '_id'];
    
    // most methods can just be proxied directly
    methods.forEach(function (k) {
        rpcAPI[k] = db[k];
        if (rpcAPI[k]) rpcAPI[k]._keep_exposed = true;
    });
    
    // one override, to pass the `.cancel()` helper via callback to the synchronous override on the other side
    rpcAPI._changes = function (opts, rpcCB) {
        var retval = db._changes(opts);
        rpcCB(retval.cancel);
    }
    rpcAPI._changes._keep_exposed = true;
    
    // just send the local result
    rpcAPI._id = db.id();
    
    return rpcAPI;
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
    opts.reliable = true;
    var cfg = {"iceServers":[{"url":"stun:23.21.150.121"}]},
        con = (opts.reliable) ? {} : { 'optional': [{'RtpDataChannels': true }] };

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
        if (handler.DEBUG) console.log(handler.LOG_SELF, "saw negotiation trigger and will create an offer");
        rtc.createOffer(function (offerDesc) {
            if (handler.DEBUG) console.log(handler.LOG_SELF, "created offer, sending to", handler.LOG_PEER);
            rtc.setLocalDescription(offerDesc);
            handler._sendSignal(offerDesc);
        }, function (e) { console.warn(handler.LOG_SELF, "failed to create offer", e); });
    };
    rtc.onicecandidate = function (evt) {
        if (evt.candidate) handler._sendSignal({candidate:evt.candidate});
    };
    // debugging
    rtc.onicechange = function (evt) {
        if (handler.DEBUG) console.log(handler.LOG_SELF, "ICE change", rtc.iceGatheringState, rtc.iceConnectionState);
    };
    rtc.onstatechange = function (evt) {
        if (handler.DEBUG) console.log(handler.LOG_SELF, "State change", rtc.signalingState, rtc.readyState)
    };
}

PeerConnectionHandler.prototype._sendSignal = function (data) {
    if (!this.onhavesignal) throw Error("Need to send message but `onhavesignal` handler is not set.");
    this.onhavesignal({target:this, signal:JSON.parse(JSON.stringify(data))});
};

PeerConnectionHandler.prototype.receiveSignal = function (data) {
    var handler = this, rtc = this._rtc;
    if (handler.DEBUG) console.log(this.LOG_SELF, "got data", data, "from", this.LOG_PEER);
    if (data.sdp) rtc.setRemoteDescription(new RTCSessionDescription(data), function () {
        var needsAnswer = (rtc.remoteDescription.type == 'offer');
        if (handler.DEBUG) console.log(handler.LOG_SELF, "set offer, now creating answer:", needsAnswer);
        if (needsAnswer) rtc.createAnswer(function (answerDesc) {
            if (handler.DEBUG) console.log(handler.LOG_SELF, "got anwer, sending back to", handler.LOG_PEER);
            rtc.setLocalDescription(answerDesc);
            handler._sendSignal(answerDesc);
        }, function (e) { console.warn(handler.LOG_SELF, "couldn't create answer", e); });
    }, function (e) { console.warn(handler.LOG_SELF, "couldn't set remote description", e) });
    else if (data.candidate) try { rtc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (e) { console.error("Couldn't add candidate", e); }
};

PeerConnectionHandler.prototype.sendMessage = function (data) {
    if (!this._channel || this._channel.readyState !== 'open') throw Error("Connection exists, but data channel is not open.");
    this._channel.send(data);
};

PeerConnectionHandler.prototype._setupChannel = function (evt) {
    var handler = this, rtc = this._rtc;
    if (evt) if (handler.DEBUG) console.log(this.LOG_SELF, "received data channel", evt.channel.readyState);
    this._channel = (evt) ? evt.channel : rtc.createDataChannel('peerpouch-dev');
    //this._channel.binaryType = 'arraybuffer';       // looks like Chrome does not support Blob atm?
    this._channel.onopen = function (evt) {
        /*if (handler.DEBUG)*/ console.log(handler.LOG_SELF, "DATA CHANNEL IS OPEN", handler._channel);
        if (handler.onconnection) handler.onconnection(handler._channel);        // BOOM!
    };
    this._channel.onmessage = function (evt) {
        if (handler.DEBUG) console.log(handler.LOG_SELF, "received message!", evt);
        if (handler.onreceivemessage) handler.onreceivemessage({target:handler, data:evt.data});
    };
    if (window.mozRTCPeerConnection) setTimeout(function () {
        rtc.onnegotiationneeded();     // FF doesn't trigger this for us like Chrome does
    }, 0);
    window.dbgChannel = this._channel;
};

PeerConnectionHandler.prototype._tube = function () {      // TODO: refactor PeerConnectionHandler to simply be the "tube" itself
    var tube = {},
        handler = this;
    tube.onmessage = null;
    tube.send = function (data) {
        handler.sendMessage(data);
    };
    handler.onreceivemessage = function (evt) {
        if (tube.onmessage) tube.onmessage(evt);
    };
    return tube;
};

function RPCHandler(tube) {
    this.onbootstrap = null;        // caller MAY provide this
    
    this._exposed_fns = Object.create(null);
    this.serialize = function (obj) {
        var messages = [];
        messages.push(JSON.stringify(obj, function (k,v) {
            if (typeof v === 'function') {
                var id = Math.random().toFixed(20).slice(2);
                this._exposed_fns[id] = v;
                return {__remote_fn:id};
            } else if (_isBlob(v)) {
                var n = messages.indexOf(v) + 1;
                if (!n) n = messages.push(v);
                return {__blob:n};
            } else return v;
        }.bind(this)));
        return messages;
    };
    
    var blobsForNextCall = [];                  // each binary object is sent before the function call message
    this.deserialize = function (data) {
        if (typeof data === 'string') {
            return JSON.parse(data, function (k,v) {
                if (v && v.__remote_fn) return function () {
                    this._callRemote(v.__remote_fn, arguments);
                }.bind(this);
                else if (v && v.__blob) {
                    var b = blobsForNextCall[v.__blob-1];
                    if (!_isBlob(b)) b = new Blob(b);       // may actually be an ArrayBuffer
                    return b;
                }
                else return v;
            }.bind(this));
            blobsForNextCall.length = 0;
        } else blobsForNextCall.push(data);
    };
    
    function _isBlob(obj) {
        return (Object.prototype.toString.call(obj) === '[object Blob]'); 
    }
    
    this._callRemote = function (fn, args) {
        var messages = this.serialize({
            fn: fn,
            args: Array.prototype.slice.call(args)
        });
        messages.forEach(function (msg) { tube.send(msg); });
    };
    
    this._exposed_fns['__BOOTSTRAP__'] = function () {
        if (this.onbootstrap) this.onbootstrap.apply(this, arguments);
    }.bind(this);
    
    
    tube.onmessage = function (evt) {
        var call = this.deserialize(evt.data);
        if (!call) return;      // 
        
        var fn = this._exposed_fns[call.fn];
        if (!fn) {
            console.warn("RPC call to unknown local function", call);
            return;
        }
        
        // leak only callbacks which are marked for keeping (most are one-shot)
        if (!fn._keep_exposed) delete this._exposed_fns[call.fn];
        
        try {
            fn.apply(null, call.args);
        } catch (e) {           // we do not signal exceptions remotely
            console.warn("Local RPC invocation unexpectedly threw: "+e, e);
        }
    }.bind(this);
}

RPCHandler.prototype.bootstrap = function () {
    this._callRemote('__BOOTSTRAP__', arguments);
};

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
                handler.onconnection = function () {
                    var rpc = new RPCHandler(handler._tube());
                    rpc.bootstrap({
                        echo: function (msg, cb) { cb(msg); },
                        api: PeerPouch._wrappedAPI(db)
                    });
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