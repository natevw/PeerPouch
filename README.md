# PeerPouch

A plugin for PouchDB which allows a remote PouchDB instance to be used locally. It transfers data over WebRTC, for simple lower-latency remote access and even particularly peer-to-peer replication!

## API

To set up a peer connection, you actually need to start with a centralized database — this hub is first used for signalling connection parameters, and *then* the connection can be used to exchange messages.

### PouchDB(anyDB, function (e, hub) { /* now you can use the methods below */ })

This isn't actually a PeerPouch call, but to get the "hub" below you simply create a PouchDB instance for a database that all peers will share. This would usually be a CouchDB server accessed via HTTPS, but PeerPouch itself doesn't really care. (For example, in testing I sometimes use IndexedDB as a hub between two tabs in the same browser.)

This hub is used for *signalling*, i.e. for exchanging information about shares and peers. Every share creates a corresponding document in the database. Additionally, when opening a share the peers exchange a number of messages via this hub, received via its changes feed.

### hub.getSharedDatabases([opts, ]cb)

Returns an array of shares available (not including ones you have shared) to `cb`. You may also provide a callback via `opts.onChange` which will receive new/_deleted shares as they are updated.

Each of these share documents will be locally modified to include a `dbname` field. This can be used to intialize using the PeerPouch WebRTC adapter, e.g. `PouchDB(share.dbname, function (e, remote) { /* now the remote share is locally accessible! */ }`.

### hub.shareDatabase(db[, opts], cb)

Allows you to share a local database to remote peers. Opts can include `.name` (intended to be a human-readble string), `.info` (any arbitrary JSON-stringifiable object).

You may also provide an event handler via `opts.onRemote` which gets info and can `evt.preventDefault()` to refuse connection. [This API is still in progress and may change. Also note that security is a bit weak as there's no way to actually verify the remote's identity without having trusted design document on a trusted hub.]

**CAUTION**: because PouchDB was designed for single-user application, any remote which connects to will have whatever privilege access *you* do to the share.

### hub.unshareDatabase(db, cb)

Removes the share information for the given database from the hub.

## Example

After including PouchDB and PeerPouch on your page, start by opening the hub:

    PouchDB("http://peerpouch-test.ipcalf.com", function (e, hub) {
        // now you can serve a database using…
        hub.shareDatabase(/* someOtherLocalPouch */);
        
        // or connect to someone else's shared database like…
        hub.getSharedDatabases(function (e,shares) {
            PouchDB(shares[0].dbname, function (e, remote) {
                remote.allDocs(function (e,result) { console.log("Peer's documents are:", result.rows); });
                // or set up two-way replication to a local DB!
                PouchDB.replicate(remote, local);
                PouchDB.replicate(local, remote);
            });
        });
    });


## Demo

Check out [sendfile](https://github.com/natevw/sendfile)?