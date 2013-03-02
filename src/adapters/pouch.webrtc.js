/*globals Pouch: true, call: false, ajax: true */
/*globals require: false, console: false */

"use strict";

// Implements the API for dealing with PouchDB peers over WebRTC
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
  
  return api;
}

// Don't bother letting peers nuke each others' databases
PeerPouch.destroy = function(name, callback) {
  setTimeout(function () { call(callback, Pouch.Errors.FORBIDDEN); }, 0);
};

// Can we breathe in this environment?
PeerPouch.valid = function() {
  // TODO: check for WebRTC+DataConnection support
  return true;
};

if (typeof module !== 'undefined' && module.exports) {
  // running in node
  var pouchdir = '../';
  Pouch = require(pouchdir + 'pouch.js');
  ajax = Pouch.utils.ajax;
}

// Register for our scheme
Pouch.adapter('webrtc', PeerPouch);
