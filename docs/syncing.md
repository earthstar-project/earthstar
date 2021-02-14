2020-07-26

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Contents**

- [Syncing and how to optimize it](#syncing-and-how-to-optimize-it)
- [Easy, slow sync](#easy-slow-sync)
- [Sync Queries (not implemented yet)](#sync-queries-not-implemented-yet)
- [Efficient sync (not implemented yet)](#efficient-sync-not-implemented-yet)
  - [Pull Protocol](#pull-protocol)
  - [Push protocol](#push-protocol)
  - [Notes and optimization ideas](#notes-and-optimization-ideas)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->


# Syncing and how to optimize it

Earthstar peers can be servers or clients or both.  "Client" or "Server" is a role that a peer plays.  A "Client" drives the conversation and keeps track of what's going on, and a "Server" just passively responds.

These asymmetrical roles make it easy to run sync over HTTP, but it can also run over a symmetrical connection like hypercore's duplex stream -- it just has to start by deciding who's the Client.

Servers
* [earthstar-pub](https://github.com/cinnamon-bun/earthstar-pub) (HTTP)

Clients
* [earthstar-cli](https://github.com/cinnamon-bun/earthstar-cli)
* browser frontends like [earthstar-foyer](https://github.com/cinnamon-bun/earthstar-foyer)

# Easy, slow sync

Syncing is really basic right now.  [This happens in earthstar's sync.ts](https://github.com/cinnamon-bun/earthstar/blob/master/src/sync.ts#L129-L190)

Note that "ingest" means "examine a document and keep it if it's newer than the one I already have for the same path and author".

There are two versions of this protocol, one for push and one for pull, from the Client's perspective.  To do a sync, just do both of them.

```
// client push
Client: POST hey, here's all my documents: [doc1, doc2, doc3, doc4]
Server: ok, I will ingest those
```

```
// client pull
Client: GET all your documents
Server: [doc1, doc2, doc3]
Client: ingests the docs
```

# Sync Queries (not implemented yet)

**Sync queries** limit the documents that are exchanged.

Each peer has 2 of these:
* **Incoming sync query** -- which documents does the peer want to get?
* **Outgoing sync query** -- which documents is the peer willing to share?

For example, an incoming sync query of `{pathStartsWith: "/wiki/"}` means you only want to get wiki-related documents.

You could also use an incoming sync query to only get recent documents from the last week.

An outgoing sync query of `{author: "@suzy.b12345...."}` means you're only willing to upload documents by a specific author, perhaps yourself.

Docs have to match the queries of both peers in order to be sent.  Since each peer has 2 of these queries, there are 4 in total to consider:

```
A pushes to B:
    Peer A  --(A's outgoing query)-->  --(B's incoming query)-->  Peer B

A pulls from B:
    Peer A  <--(A's incoming query)--  <--(B's outgoing query)--  Peer B
```

# Efficient sync (not implemented yet)

## Pull Protocol

Goals:
* Protocol can be interrupted and resumed later
* Nothing breaks if the documents change in the middle of syncing (e.g. because the user edits something).
* This protocol can be running in parallel, syncing with several peers at the same time

Challenges:
* We can't pre-compute a giant Merkle Tree because each peer might request a different subset of the data using a sync query
* This is more than just set replication, because documents are mutable, so we need to include the document timestamps in there somewhere so we can know which one is newer.

Overview
* Client asks for documents in batches of 1000
* Server sends minimal details about the documents
* Client figures out which ones it needs and asks for the full documents

```
// client pull
Client:
    Tell me timestamps for the first 1000 documents that match my incoming query {...}.
Server:
    I will query my docs that match the client's incoming query AND server's outgoing query, limit 1000.
    return [
        {path: '...', author: '...', timestamp: 15000000},
        {path: '...', author: '...', timestamp: 15000000},
        ...
    ]

Client: 
    I will figure out which of those are completely new to me,
    or newer than an existing doc that I have.
    I will ask for details on the ones I need.

Client:
    Tell me details for [{path: '...', author: '...'}, {...}]
Server:
    return the complete documents

Client:
    I have now finished the first batch of 1000.
    Tell me timestamps for documents that match my incoming query,
    and are sorted after the last one you sent {path: '...', author: '...'}.
Server:
    (same as above)

Repeat until server returns an emtpy array.
```

## Push protocol

TODO.  It's almost the same as above but with the roles reversed.

## Notes and optimization ideas

* The default sort order is alphabetical by path.  This could be configurable.  The receiving peer should declare its desired sort order in its incoming sync query.  Other choices could be oldest-first and newest-first (by document.timestamp).

* The client could predict the server's list of {path,author,timestamp}.  The server can send just the `sha256` hash of this list, and the client will know if it matches its own prediction.  For this to work:
    * We need to define how to encode the list before hashing it.  JSON is not deterministic enough.
    * The client will have to ask the server for its outgoing sync query, and both sides will have to query and sort results in exactly the same way.

* When the client requests full details of some documents, it can combine its requests into several range queries like `{path_gte: "/wiki/Banana", path_lte: "/wiki/Grape"}`

* Peers could keep track of an additional property of documents, "timestamp received by me", which would increase monotonically within each peer.  Peers could then remember "Last time I talked to Peer X, they gave me a doc they received at 17227308273.  Now I can resume from that point".
    * Peers would have to remember each other by device ID, not just by author address.
    * This only works if syncing sorted oldest-first by timestampReceived, and if the sync query has not changed.  Otherwise you might have a gap in the documents which would never be filled.
    * If a peer does something drastic like removing a workspace and adding it back again, they might need to reset their deviceID.
    * There is reduced privacy if you can know a device's deviceID and the timestampReceived of its documents.  You could figure out which device is the original source for a document by comparing those timestamps, and you could learn when a user is on their phone, their home computer or work computer.
