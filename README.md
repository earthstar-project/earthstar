# Stone Soup

**WIP** April 2021

This is a sketch of ideas for improving the way [Earthstar](https://github.com/earthstar-project/earthstar) is split into classes.

Much of Earthstar is just faked here -- signing, document validity checking.

## Splitting `IStorage` into `Frontend` and `Backend` classes

This has nothing to do with normal web "frontend" and "backend", I should rename them.

Think of this as `IStorageNiceAPIFullOfComplexity` and `IStorageSimpleLowLevelDriver`.

I want to make it easier to add new kinds of storage so I'm splitting IStorage into two parts:

The Frontend does:
* the complex annoying stuff
* set(): sign and add a document
* ingest(): validate and accept a document from the outside
* followers and events
* user-friendly helper functions, getters, setters

The Backend does:
* simple stuff
* query for documents
* maintain indexes for querying (hopefully provided by the underlying storage technology)
* simple upsert of a document

Possibly even you can have multiple frontends for one backend, for example when you're using multiple tabs with indexedDb or localStorage.

## "Reliable indexing / streaming"

This shows an implementation of the "reliable indexing" idea discussed in [this issue](https://github.com/earthstar-project/earthstar/issues/66).

### The problem

We have livestreaming now, over the network and also to local subscribers, all based on `onWrite` events.

If you miss some events, you can't recover -- you have to do a full batch download of every document.

Events also don't tell you what was overwritten, which you might need to know to update a Layer or index.

### The solution: `localIndex`

Each Storage keeps track of the order that it receives documents, and assignes each doc a `localIndex` value which starts at 1 and increments from there with every newly written doc.

This puts the documents in a nice linear order that can be used to reliably stream, and resume streaming, from the Storage.

When we get a new version of a document, it gets a new `localIndex` and goes at the end of the sequence, and the old version vanishes, leaving a gap in the sequence.  It's ok that there are gaps.

The `localIndex` is particular to a certain IStorage.  It's kept in the `Doc` object but it's not really part of it; it's not included in the signature.  It's this IStorage's metadata about that document.

### Querying by localIndex

This lets you easily resume where you left off.  You can get batches of N docs at a time if you want, using the `limit` option.

```ts
storage.getDocsSinceLocalIndex(
    startAt: LocalIndex,
    limit?: number): Doc[];
```

(You can also still look up documents by path in the usual old way.)

### Followers: Reliable streaming locally, to subscribers or indexes

The old `onWrite` events are gone.  Now, there's now a new way to subscribe to a Storage: with a `Follower`.  A follower is like a pointer that moves along the sequence of documents, in order by `localIndex`, running a callback on each one.

This is a Kafka or Kappa-db style architecture.

You could use this to build an index or Layer that incrementally digests the content of an IStorage without ever missing anything, even if it only runs occasionally.  It just resumes from the last `localIndex` it saw, and proceeds from there.

Followers are async; they move along the sequence at their own pace, processing one document at a time.  There may be many followers attached to an IStorage, each crawling along at their own different speeds.

There may also be sync-style followers -- the entire program would wait for them to always be caught up, to provide backpressure and keep a big backlog of work from developing.

You can start a Follower anywhere in the sequence: at the beginning (good for indexes and Layers), or at the current most recent document (good for live syncing new changes).

### Reliable streaming over the network, when syncing

(Not implemented in this code yet)

When we send docs over the network we will send the `localIndex` to help the other side track where they are in our own sequence.  The other side will then discard the property and put their own `localIndex` on the document when they store it.

Peers will remember, for each other peer, which is the latest `localIndex` they've seen from that peer, so they can resume syncing from there.

This is similar to how append-only logs are synced in Scuttlebutt and Hyper, except our logs have gaps.

## More informative `onWrite` events

TODO: this is being moved into Followers.

## Slightly different querying

Querying has been made more organized -- see the Query type in `types.ts`.  It looks a bit more like an SQL query but the pieces are written in the order they actually happen, so it's easier to understand.

The order is:
* history (all or latest only)
* orderBy
* startAt (continue from a certain point)
* filter - the same options, timestamp, pathStartswith, etc etc
* limit

Also, the `cleanUpQuery` function is fancier and will also figure out if the query will match `all`, `some`, or `nothing` documents.  This helps with optimizations elsewhere.

## Problems left to solve

* Ephemeral documents disappear without leaving a trace, do we need events for that?
* An IStorage might significantly change or start over, by deleting most of its local documents and choosing a different sync query.  Then we'd need to tell subscribers and peers that we're effectively a different IStorage now.
  * localIndex could be a tuple `[generation, localIndex]` where generation is an integer that increments on each big change like that
  * or give each IStorage a UUID which gets randomly changed when big changes happen.  This would be helpful for other reasons too (to prevent echoing back documents to the storage that just gave them back to us, we need to track who gave them to us)
* Syncing by `localIndex` doesn't work very well when you also have a sync query, because you have to scan the entire sequence to find the couple of docs you care about.  We probably still want another way of efficient syncing that goes in path order and uses hashing in some clever way, sort of like a Merkle tree but not.

## Silly new vocabulary ideas

Very tentative idea to rename Earthstar to Stone Soup.

It's probably a bad idea to use cute names, but:

```
Earthstar       Stone Soup

Workspace       Soup?
Author          Chef?
Storage         Bowl, Pot, Cauldron, Crockpot, Saucepan
Document        Doc
Pub
Peer / Node     
```
