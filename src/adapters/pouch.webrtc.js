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


PeerPouch._doctypes = {
    offer: 'com.stemstorage.peerpouch.offer'
}


PeerPouch.Presence = function(hub, opts) {
  opts || (opts == {});
  
  // hub is *another* Pouch instance (typically http type) — we'll use that database for communicating presence/offers/answers!
  // opts includes: name string, identity string/TBD, profile object, share {name:db}, peerUpdate callback
  // api allows: getPeers(), connectTo(), disconnect()
  
  var self = {
    _id: 'offer-'+Math.random().toFixed(5).slice(2),
    name: opts.name || "Friendly neighbor",
    identity: opts.identity || Math.random().toFixed(20).slice(2),
    profile: opts.profile || {},
    shares: Object.keys(opts.shares || {}),
    offer: null
  };
  self.profile.browser = opts.browser || navigator.userAgent.replace(/^.*(Firefox|Chrome|Mobile)\/([0-9.]+).*$/, "$1 $2").replace("Mobile", "Bowser");
  self[PeerPouch._doctypes.offer] = true;
  
  var api = {};
  
  api.joinHub = function (cb) {
    // TODO: get a WebRTC offer and store to hub
    
  };
  
  api.leaveHub = function (cb) {
    // TODO: remove offer document from hub
  };
  
  api.getPeers = function (cb) {
    function map(doc) {
      if (doc[PeerPouch._doctypes.offer] && doc.identity !== self.identity) emit(doc.identity, doc.name)
    }
    hub.query({map:map}, {include_docs:true}, function (e, d) {
      if (e) cb(e);
      else cb(null, d.rows.map(function (d) { return d.doc; }));
    });
  };
  
  return api;
};


if (typeof module !== 'undefined' && module.exports) {
  // running in node
  var pouchdir = '../';
  Pouch = require(pouchdir + 'pouch.js');
  ajax = Pouch.utils.ajax;
}

// Register for our scheme
Pouch.adapter('webrtc', PeerPouch);

Pouch.dbgPeerPouch = PeerPouch;