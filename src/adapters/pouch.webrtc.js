/*globals Pouch: true, call: false, ajax: true */
/*globals require: false, console: false */

"use strict";

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
  message: 'com.stemstorage.peerpouch.message',
  ddoc_name: 'peerpouch-dev'
}

var _t = PeerPouch._types;     // local alias for brevitation…
function _ddoc_replacer(k,v) {
  return (typeof v === 'function') ? v.toString().replace(/_t.(\w+)/, function (m,t) {    // …and hacky unbrevitation
    return JSON.stringify(_t[t]);
  }) : v;
}

PeerPouch._ddoc = JSON.parse(JSON.stringify({
  _id: '_design/' + _t.ddoc_name,
  filters: {
    signalling: function (doc, req) {
      return (doc[_t.presence] || (doc[_t.message] && doc.recipient === req.query.identity));
    }
  },
  views: {
    peers_by_identity: {
      map: function (doc) { if (doc[_t.offer]) emit(doc.identity, doc.name); }
    }
  }
}, _ddoc_replacer));

PeerPouch.Presence = function(hub, opts) {
  opts || (opts == {});
  
  // hub is *another* Pouch instance (typically http type) — we'll use that database for communicating presence/offers/answers!
  // opts includes: name string, identity string/TBD, profile object, share {name:db}, peerUpdate callback
  // api allows: getPeers(), connectTo(), disconnect()
  
  // TODO: add concept of "separate" peer groups within a common hub?
  
  var RTCPeerConnection = window.RTCPeerConnection || webkitRTCPeerConnection || mozRTCPeerConnection;
  var RTCSessionDescription = window.RTCSessionDescription || webkitRTCSessionDescription || mozRTCSessionDescription;
  
  // TODO: make ICE (and other channel setup params?) user-configurable
  var cfg = {"iceServers":[{"url":"stun:23.21.150.121"}]},
      con = { 'optional': [{'DtlsSrtpKeyAgreement': true}, {'RtpDataChannels': true }] },
      rtc = new RTCPeerConnection(cfg, con);      // TODO: we'll actually need one of these for each connected peer
  // NOTE: createDataChannel needs `open /Applications/Google\ Chrome\ Canary.app --args --enable-data-channels` :-(
  
  var self = {
    _id: 'offer-'+Math.random().toFixed(5).slice(2),
    name: opts.name || "Friendly neighbor",
    identity: opts.identity || Math.random().toFixed(20).slice(2),
    profile: opts.profile || {},
    shares: Object.keys(opts.shares || {}),
    offer: null
  };
  self.profile.browser = opts.browser || navigator.userAgent.replace(/^.*(Firefox|Chrome|Mobile)\/([0-9.]+).*$/, "$1 $2").replace("Mobile", "Bowser");
  self[_t.offer] = true;
  
  function updateSelf(cb) {
    hub.post(self, function (e,d) {
      if (!e) self._rev = d.rev;
      else console.warn("Trouble sharing presence", e, d);
      call(cb, e, d);
    });
  }
  
  var api = {};
  
  // gets a WebRTC offer and shares it via hub
  api.joinHub = function (cb) {
    // TODO: probably need to addStream
    rtc.createOffer(function (offerDesc) {
        rtc.setLocalDescription(offerDesc);
        self.offer = offerDesc.sdp;
        updateSelf(cb);
    }, function (e) { call(cb,e); });
  };
  
  api.leaveHub = function (cb) {
    hub.remove(self._id, cb);
  };
  
  api.connectToPeer = function (peer, cb) {
    rtc.setRemoteDescription(RTCSessionDescription(peer.offer), function () {
      rtc.createAnswer(function (answerDesc) {
        rtc.setLocalDescription(answerDesc);
        // TODO: communicate answerDesc.sdp (and ICE candidates) to the peer somehow
        call(cb);
      }, function (e) { call(cb,e); });
    }, function (e) { call(cb,e); });
  };
  
  api.getPeers = function (cb) {
    hub.query(_t.ddoc_name+'/peers_by_identity', {include_docs:true}, function (e, d) {
      if (e) cb(e);
      else cb(null, d.rows.filter(function (r) { return r.doc.identity !== self.identity; }).map(function (r) { return r.doc; }));
    });
  };
  
  if (!opts.nojoin) api.joinHub();
  
  return api;
};

PeerPouch.Presence.verifyHub = function (hub, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts;
    opts = {};
  }
  hub.put(PeerPouch._ddoc, function (e,d) {
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

Pouch.dbgPeerPouch = PeerPouch;