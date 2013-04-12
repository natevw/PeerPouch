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


// Implements the API for dealing with a PouchDB peer's database over WebRTC
var PeerPouch = function(opts, callback) {
  function TODO(callback) {
    // TODO: callers of this function want implementations
    setTimeout(function () { call(callback, Pouch.Errors.NOT_IMPLEMENTED); }, 0);
  }
  
  // expect we'll need: basic identity for available peers, share per-peer connections between db instances
  
  // Our concrete adapter implementations and any additional public api
  var api = {};
  
  // Use the peer's ID (prefixed?)
  api._id = function() {
    // TODO: implement for realsies
    return Math.random().toFixed(16).slice(2);
  };
  
  // Let our users send arbitrary chatter since we have a connection anyway
  // (We'll likely use this internally for our own communications too)
  api.message = function(options, callback) {
    TODO(callback);     // we'll also want a way to listen for messages back
  };
  
  
  // Concrete implementations of abstract adapter methods
  
  // TODO: update this with latest (e.g. _getRevisionTree, _removeDocRevisions)
  
  // these should be implemented as very generic simple RPC-type stuff (client here and server in PeerPouch.Presence)
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
  setTimeout(function () { call(callback, Pouch.Errors.FORBIDDEN); }, 0);
};

// Can we breathe in this environment?
PeerPouch.valid = function() {
  // TODO: check for WebRTC+DataConnection support
  return true;
};


PeerPouch._types = {
  presence: 'com.stemstorage.peerpouch.presence',
  signal: 'com.stemstorage.peerpouch.signal',
  share: 'com.stemstorage.peerpouch.share',
  ddoc_name: 'peerpouch-dev'
}

var _t = PeerPouch._types;     // local alias for brevitation…
function _ddoc_replacer(k,v) {
  return (typeof v === 'function') ? v.toString().replace(/_t.(\w+)/, function (m,t) {    // …and hacky unbrevitation
    return JSON.stringify(_t[t]);
  }) : v;
}
function _jsonclone(d, r) {
  //return JSON.parse(JSON.stringify(d,r));
  
  // WORKAROUND: https://code.google.com/p/chromium/issues/detail?id=222982#makechanges
  if (r) {
    function toJSON(k, d) {
      d = r(k, d);
      if (typeof d === 'object') Object.keys(d).forEach(function (k) {
        d[k] = toJSON(k,d[k]);
      });
      return d;
    }
    d = toJSON(null, d);
  }
  return JSON.parse(JSON.stringify(d));
}


PeerPouch._ddoc = _jsonclone({
  _id: '_design/' + _t.ddoc_name,
  filters: {
    signalling: function (doc, req) {
      return (doc[_t.presence] || (doc[_t.signal] && doc.recipient === req.query.identity));
    }
  },
  views: {
    peers_by_identity: {
      map: function (doc) { if (doc[_t.presence]) emit(doc.identity, doc.name); }
    }
  }
}, _ddoc_replacer);

PeerPouch.Presence = function(hub, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts;
    opts = {};
  }
  opts || (opts == {});
  
  // hub is *another* Pouch instance (typically http type) — we'll use that database for communicating presence/offers/answers!
  // opts includes: name string, identity string/TBD, profile object, share {name:db}, peerUpdate callback
  // api allows: getPeers(), connectTo(), disconnect()
  
  // TODO: add concept of "separate" peer groups within a common hub?
  
  var RTCPeerConnection = window.RTCPeerConnection || webkitRTCPeerConnection || mozRTCPeerConnection,
      RTCSessionDescription = window.RTCSessionDescription || webkitRTCSessionDescription || mozRTCSessionDescription,
      RTCIceCandidate = window.RTCIceCandidate || webkitRTCIceCandidate || mozRTCIceCandidate;
  
  // TODO: make ICE (and other channel setup params?) user-configurable
  var cfg = {"iceServers":[{"url":"stun:23.21.150.121"}]},
      con = { 'optional': [{'DtlsSrtpKeyAgreement': true}, {'RtpDataChannels': true }] };
  // NOTE: createDataChannel needs `open /Applications/Google\ Chrome\ Canary.app --args --enable-data-channels` :-(
  
  var self = {
    _id: 'peer-'+Math.random().toFixed(5).slice(2),
    name: opts.name || "Friendly neighbor",
    // TODO: see if WebRTC built-in identity provider stuff useful: http://www.ietf.org/proceedings/82/slides/rtcweb-13.pdf
    identity: opts.identity || Math.random().toFixed(20).slice(2),      
    profile: opts.profile || {},
    shares: Object.keys(opts.shares || {})
  };
  self.profile.browser = opts.browser || navigator.userAgent.replace(/^.*(Firefox|Chrome|Mobile)\/([0-9.]+).*$/, "$1 $2").replace("Mobile", "Bowser");
  self[_t.presence] = true;
  
  function updateSelf(cb) {
    if (updateSelf.againCallbacks) {
      updateSelf.againCallbacks.push(cb);
      return;
    }
    updateSelf.againCallbacks = [];
    self.lastUpdate = new Date().toISOString();
    hub.post(self, function (e,d) {
      var againCallbacks = updateSelf.againCallbacks;
      delete updateSelf.againCallbacks;
      if (!e) self._rev = d.rev;
      else console.warn("Trouble sharing presence", e, d);
      call(cb, e, d);
      if (againCallbacks.length) updateSelf(function (e,d) {
        againCallbacks.forEach(function (cb) { call(cb,e,d); });
      });
    });
  }
  
  var peers = Object.create(null);     // *connected* peers
  
  function associatedConnection(peer, initiatorCB) {
    var peerInfo = peers[peer.identity];
    if (!peerInfo) {
      console.log(self.identity, "creating connection for", peer.identity);
      peerInfo = peers[peer.identity] = {};
      
      // let code below use simple callback, but make sure all interested callers notified
      peerInfo.callbacks = [initiatorCB];
      var cb = function () {
        var ctx = this, args = arguments;
        peerInfo.callbacks.forEach(function (cb) { if (cb) cb.apply(ctx, args); });
        delete peerInfo.callbacks;
        cb = null;
      };
      
      var rtc = peerInfo.connection = new RTCPeerConnection(cfg, con);
      
      function setupChannel(evt) {
        if (evt) console.log(self.identity, "received data channel", evt.channel.readyState);
        // NOTE: unreliable channel is not our preference, but that's all current FF/Chrome have
        peerInfo.channel = (evt) ? evt.channel : rtc.createDataChannel('peerpouch-dev', {reliable:false});
        peerInfo.channel.onopen = function (evt) {
          console.log(self.identity, "data channel is open");
          call(cb, null, peer);
        };
        peerInfo.channel.onmessage = function (evt) {
            console.log("Received message!", evt);
            receiveMessage(peer, JSON.parse(evt.data));
        };
      }
      if (initiatorCB) setupChannel();
      else rtc.ondatachannel = setupChannel;
      
      rtc.onnegotiationneeded = function (evt) {
        console.log(self.identity, "saw negotiation trigger and will create an offer");
        rtc.createOffer(function (offerDesc) {
            console.log(self.identity, "created offer, sending to", peer.identity);
            rtc.setLocalDescription(offerDesc);
            sendSignal(peer, _jsonclone(offerDesc));
        }, function (e) { call(cb,e); });
      };
      rtc.onicecandidate = function (evt) {
        if (evt.candidate) sendSignal(peer, {candidate:_jsonclone(evt.candidate)});
      };
      // debugging
      rtc.onicechange = function (evt) {
        console.log(self.identity, "ICE change", rtc.iceGatheringState, rtc.iceConnectionState);
      };
      rtc.onstatechange = function (evt) {
        console.log(self.identity, "State change", rtc.signalingState, rtc.readyState)
      };
    } else if (peerInfo.callbacks) { 
      peerInfo.callbacks.push(initiatorCB);
    } else setTimeout(function () {
      var e = (peerInfo.channel.readyState === 'open') ? null : Error("Connection exists, but data channel not open!");
      call(initiatorCB, e);
    }, 0);
    return peerInfo.connection;
  }
  
  // "messages" are peer-to-peer
  function sendMessage(peer, data) {
      var peerInfo = peers[peer.identity];
      if (!peerInfo) throw Error("Not connected to peer!");
      peerInfo.channel.send(JSON.stringify(data));
  }
  function receiveMessage(peer, data) {
      if (data.type === 'rpc') {
          _rpc_recv(peer, data.fn, data.args);
      }
  }
  
  var _rpc_local = Object.create(null);
  function _rpc_send(peer, fn, args) {
    sendMessage(peer, {
      type:'rpc', fn:fn,
      args: JSON.stringify(args, function (k,v) {
        if (typeof v === 'function') {
          var id = Math.uuid();
          // TODO: we need a cleanup strategy
          // https://github.com/TooTallNate/node-weak (node.js only)
          // http://wiki.ecmascript.org/doku.php?id=strawman:weak_refs (ES-never)
          // hacky idea: mark functions we expect to be called only once, assume heartbeat within a timeout for the rest?
          _rpc_local[id] = v;
          v = {__rpc:id};
        }
        return v;
      })
    });
  }
  function _rpc_recv(peer, fn, args) {
    _rpc_local[fn].apply(null, JSON.parse(args, function (k,v) {
      if (v.__rpc) {
        var _rpc_id = v.__rpc;
        v = function () {     // IMPORTANT: when this is GC'ed the remote should remove _rpc_id from its _rpc_local
          _rpc_send(peer, _rpc_id, arguments);
        };
      }
      return v;
    }));
  }
  
  // TODO: implement this bootstrapping stuff somewhere
  /*
  _rpc_local['__db__'] = function (db, methods) {
    // register (/unregister) locally
  };
  _rpc_send(peer, '__db__', ["dbname", {
    get: function () {},
    put: function () {}
  }]);
  */
  
  // "signals" are through centralized hub
  function sendSignal(peer, data) {
    var msg = {
      sender: self.identity,
      recipient: peer.identity,
      data: data
    };
    msg[_t.signal] = true;
    hub.post(msg, function (e) { if (e) throw e; });
  }
  function receiveSignal(peer, data) {
    console.log(self.identity, "got", data, "from", peer.identity);
    var rtc = associatedConnection(peer);
    if (data.sdp) rtc.setRemoteDescription(new RTCSessionDescription(data), function () {
      var needsAnswer = (rtc.remoteDescription.type == 'offer');
      console.log(self.identity, "set offer, now creating answer:", needsAnswer);
      if (needsAnswer) rtc.createAnswer(function (answerDesc) {
        console.log(self.identity, "got anwer, sending back to", peer.identity);
        rtc.setLocalDescription(answerDesc);
        sendSignal(peer, _jsonclone(answerDesc));
      }, function (e) { console.warn(self.identity, "couldn't create answer", e); });
    }, function (e) { console.warn(self.identity, "couldn't set remote description", e) });
    else if (data.candidate) rtc.addIceCandidate(new RTCIceCandidate(data.candidate));
  }
  
  var changesListener;
  function listenForChanges() {
    var cancelListen = false;
    changesListener = {
      cancel: function () { cancelListen = true; }
    };
    hub.info(function (e,d) {
      if (e) throw e;
      var opts = {
        //filter: _t.ddoc_name+'/signalling',       // see https://github.com/daleharvey/pouchdb/issues/525
        include_docs: true,
        continuous:true,
        since:d.update_seq
      };
      opts.onChange = function (d) {
        var doc = d.doc;
        if (doc[_t.signal] && doc.recipient === self.identity) {
          receiveSignal({identity:doc.sender}, doc.data);
          // HACK: would hub.remove() but this is actually "simpler" due to https://github.com/daleharvey/pouchdb/issues/558
          hub.post({_id:doc._id,_rev:doc._rev,_deleted:true}, function (e) { if (e) throw e; });
        } else if (doc[_t.presence] && doc.identity !== self.identity) {
          peersChanged(doc);
        }
      };
      if (!cancelListen) changesListener = hub.changes(opts);
      else changesListener = null;
    });
  }
  
  var api = {};
  
  // c.f. http://dev.w3.org/2011/webrtc/editor/webrtc.html#simple-peer-to-peer-example
  // …and http://dev.w3.org/2011/webrtc/editor/webrtc.html#peer-to-peer-data-example
  
  // share our profile via hub
  api.joinHub = function (cb) {
    delete self._deleted;
    updateSelf(cb);
    listenForChanges();
  };
  
  api.leaveHub = function (cb) {
    self._deleted = true;
    updateSelf(cb);
    if (changesListener) changesListener.cancel();
  };
  
  api.connectToPeer = associatedConnection;
  
  api.sendToPeer = sendMessage;
  
  // TODO: disconnectFromPeer
  
  var peerListeners = [];
  function peersChanged(peer) {
    peerListeners.forEach(function (cb) {
      call(cb, peer);
    });
  }
  
  api.getPeers = function (opts, cb) {
    if (typeof opts === 'function') {
      cb = opts;
      opts = {};
    }
    opts || (opts = {});
    hub.query(_t.ddoc_name+'/peers_by_identity', {include_docs:true}, function (e, d) {
      if (e) cb(e);
      else cb(null, d.rows.filter(function (r) { return r.doc.identity !== self.identity; }).map(function (r) { return r.doc; }));
    });
    
    var cancelListener = function () {};
    if (opts.onChange) {      // WARNING/TODO: listener may get changes before cb returns initial list!
      peerListeners.push(opts.onChange);
      cancelListener = function () {
        var cbIdx = peerListeners.indexOf(opts.onChange);
        if (~cbIdx) peerListeners.splice(cbIdx, 1);
      }
    }
    return {cancel:cancelListener};
  };
  
  // TODO: is this really the best way to tackle changing client info?
  api.updateInfo = function (newOpts, cb) {
    // HACK: just update shares as needed for test page
    Object.keys(newOpts).forEach(function (k) { opts[k] = newOpts[k]; });
    self.shares = Object.keys(opts.shares || {});
    updateSelf(cb);
  };
  
  api.makeURL = function (peer, db) {
    return "webrtc://" + peer.identity + '/' + db;
  };
  
  if (!opts.nojoin) api.joinHub(cb);
  
  return api;
};

PeerPouch.Presence.verifyHub = function (hub, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts;
    opts = {};
  }
  hub.put(PeerPouch._ddoc, function (e,d) {
    if (e && e.status === 409) {
      console.warn("Found an existing design doc, proceeding with it…");
      e = null;
    }
    // TODO: handle versioning (leave if higher minor, upgrade if lower minor, error if major difference)
    call(cb, e, (e) ? null : {version:'dev'});
  });
}


if (typeof module !== 'undefined' && module.exports) {
  // running in node
  var pouchdir = '../';
  Pouch = require(pouchdir + 'pouch.js');
  ajax = Pouch.utils.ajax;
}

// Register for our scheme
Pouch.adapter('webrtc', PeerPouch);


var SharePouch = function (hub) {
  // NOTE: this plugin's methods are intended for use only on a **hub** database
  
  // this chunk of code manages a combined _changes listener on hub for any share/signal(/etc.) watchers
  var watcherCount = 0,     // easier to refcount than re-count!
      watchersByType = Object.create(null),
      changesListener = null;
  function addWatcher(type, cb) {
    var watchers = watchersByType[type] || (watchersByType[type] = []);
    watchers.push(cb);
    watcherCount += 1;
    if (watcherCount > 0 && !changesListener) {     // start listening for changes (at current sequence)
      var cancelListen = false;
      changesListener = {
        cancel: function () { cancelListen = true; }
      };
      hub.info(function (e,d) {
        if (e) throw e;
        var opts = {
          //filter: _t.ddoc_name+'/signalling',       // see https://github.com/daleharvey/pouchdb/issues/525
          include_docs: true,
          continuous:true,
          since:d.update_seq
        };
        opts.onChange = function (d) {
          Object.keys(watchersByType).forEach(function (type) {
            var watchers = watchersByType[type];
            if (d.doc[type] && watchers) watchers.forEach(function (cb) { call(cb, d.doc); });
          });
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
  
  var sharesByRemoteId = Object.create(null),     // ._id of share doc
      sharesByLocalId = Object.create(null);      // .id() of database
  function share(db, opts, cb) {
    if (typeof opts === 'function') {
      cb = opts;
      opts = {};
    } else opts || (opts = {});
    
    var share = {
      _id: 'share-'+Math.uuid(),
      name: opts.name || null,
      info: opts.info || null
    };
    hub.post(share, function (e, d) {
      if (!e) share._rev = d.rev;
      call(cb, e, d);
    });
    share._signalWatcher = addWatcher(_t.signal, function (signal) {
      if (signal.recipient !== share._id) return;
      // TODO: *alllllll* the PeerConnection stuff :-P
    });
    sharesByRemoteId[share._id] = sharesByLocalId[db.id()] = share;
  }
  function unshare(db, cb) {      // TODO: call this automatically from _delete hook whenever it sees a previously shared db?
    var share = sharesByLocalId[db.id()];
    hub.post({_id:share._id,_rev:share._rev,_deleted:true}, cb);
    share._signalWatcher.cancel();
    delete sharesByRemoteId[share._id];
    delete sharesByLocalId[db.id()];
  }
  
  function getShares(opts, cb) {
    if (typeof opts === 'function') {
      cb = opts;
      opts = {};
    }
    opts || (opts = {});
    hub.query(_t.ddoc_name+'/shares', {include_docs:true}, function (e, d) {
      if (e) cb(e);
      else cb(null, d.rows.filter(function (r) { return !(r.doc._id in sharesById); }).map(function (r) { return r.doc; }));
    });
    if (opts.onChange) {      // WARNING/TODO: listener may get changes before cb returns initial list!
      return addWatcher(_t.share, opts.onChange);
    }
  }
  
  return {shareDatabase:share, unshareDatabase:unshare, getSharedDatabases:getShares};
}

SharePouch._delete = function () {};      // blindly called by Pouch.destroy


Pouch.plugin('hub', SharePouch);



Pouch.dbgPeerPouch = PeerPouch;