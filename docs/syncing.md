2020-07-26

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Contents**

- [More detail about syncing](#more-detail-about-syncing)
- [Easy, slow sync](#easy-slow-sync)
- [Efficient sync (not implemented yet)](#efficient-sync-not-implemented-yet)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->


## More detail about syncing

Earthstar peers can be servers or clients or both.  Servers respond to queries, clients request queries.

Syncing is a conversation between a client (who drives the conversation and tries to keep the sync efficient) and a server (who just answers questions).  This is asymmetrical to make it fit better in a HTTP paradigm (vs. a duplex stream paradigm like SSB and hypercore).

Servers
* [earthstar-pub](https://github.com/cinnamon-bun/earthstar-pub) (HTTP)
* earthstar-graphql

Clients
* [earthstar-cli](https://github.com/cinnamon-bun/earthstar-cli)
* browser frontends like [earthstar-wiki](https://github.com/cinnamon-bun/earthstar-wiki) and [earthstar-os](https://github.com/cinnamon-bun/earthstar-os)

For two servers to sync with each other, one of them has to act as a client -- it needs some extra code to drive the sync conversation.  E.g. you'd somehow ask graphQL server A to start a long-running background process that talks as a client to graphQL server B.

## Easy, slow sync

Syncing is really basic right now.  [This happens in earthstar's sync.ts](https://github.com/cinnamon-bun/earthstar/blob/master/src/sync.ts#L129-L190)

```
// client pull
Client: GET all your documents
Server: [doc1, doc2, doc3]

// client push
Client: POST hey, here's all my documents: [doc1, doc2, doc3, doc4]
Server: ok
```

## Efficient sync (not implemented yet)

This also adds the concept of "replication queries", where each side can express what data it wants to have.  Maybe a peer only wants wiki documents, or recent documents.

```
// client pull
Client: GET hashes of all your documents that match my replication query `{pathPrefix: "/chess"}`
Server: [hash1, hash2, hash3]

Client: GET I don't have [hash2, hash3] yet, give me those.
Server: [doc2, doc3]

// client push
Client: GET What do you want?
Server: My replication query is `{pathPrefix: "/wiki"}`

Client: POST I have [hash1, hash2, hash3], what do you need?
Server: I need [hash1, hash2]

Client: POST [doc1, doc2]
Server: ok thanks
```