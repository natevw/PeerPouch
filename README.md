# PeerPouch

Implementing an adapter (and plugin) for PouchDB that proxies to a remote PouchDB instance over WebRTC, for particularly peer-to-peer replication!

## API

To set up a peer connection, you actually need to start with a centralized database — this hub is first used for signalling connection parameters, and *then* the connection can be used to exchange messages.

After including PouchDB and PeerPouch on your page, start by opening the hub:

    PouchDB("http://peerpouch-test.ipcalf.com", function (e, hub) {
        // now you can serve a database using…
        hub.shareDatabase(/* someOtherLocalPouch */);
        
        // or connect to someone else's shared database like…
        hub.getSharedDatabases(function (e,shares) {
            PouchDB(shares[0].dbname, function (e, remote) {
                // NOTE: actually calling methods on the remote database is not implemented yet
                remote.allDocs(function (e,result) { console.log("Peer's documents are:", result.rows); });
            });
        });
    });


## Demo

`python -m SimpleHTTPServer`, then open <http://localhost:8000/webrtc_test.html>, then show the JS console for a bunch of verbose logging. Currently have data connection setup working (Chrome–Chrome, Firefox–Firefox, but not mixed…) but no RPC yet.