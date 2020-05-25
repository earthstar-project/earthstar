
# Keywing

Status: early alpha

## A distributed, syncable key-value store

It's like leveldb but it syncs.

It's like Couchdb but with signatures and encryption, so untrusted nodes can help move data around without tampering.

It's like Scuttlebutt but with more flexibility, so you can do partial sync.

It's like DAT but simpler and more modular, so you can implement it in any language and make it fit your use case.

It's like IPFS but simpler and less structured.

It has fewer cryptography guarantees than the above, so it's useful in informal settings amongst semi-trusted people, not for producing audit logs.

## What's nice about it

* It's NOT an immutable append-only log.  You can delete things.
* You can use multiple devices with the same identity.
* Easy, flexible sync options for selective sync (only some keys, only recent data, only certain authors, ...)
* Can sync over HTTP, so it's easy to host places like Glitch.
* Can sync over duplex stream, so it works with hyperswarm.
* Simple algorithms, easy to implement without a lot of dependencies

## Use cases

Apps similar to these could be built on top of Keywing:
* Wikis
* End-to-end encrypted chat
* Slack, IRC
* Facebook, Scuttlebutt, Discourse, Forums
* Twitter, Mastodon
* Trello, GitHub Issues, Asana, Todo lists
* Google sheets
* Collaborative drawing or music tools
* Multi-user Twine for making interactive fiction games

## What doesn't it do?

It's not real-time yet - changes propagate over a few minutes.  This will improve but might not ever get below 1s latency.

It doesn't handle tricky conflict resolution like Google Docs.

The crypto is not audited or bulletproof, it's just enough to keep your friends from seeing your chats with your other friends.

## Example

Let's create a `KeywingStore`, a key-value database that syncs.

* see more in `src/keywingStore.test.ts`
```ts
// The API for a store
export interface IKeywingStore {
    // A KeywingStore is all about a single workspace.
    // Workspaces are separate universes of data
    // that don't sync with each other.
    constructor(workspace : string)

    // look up a key and get the corresponding value
    getValue(key : string) : string | undefined;
    // or "item", which is an object with more details (author, timestamp...)
    getItem(key : string) : Item | undefined;

    // query with a variety of options - filter by keys and authors, etc
    items(query? : QueryOpts) : Item[];
    keys(query? : QueryOpts) : string[];
    values(query? : QueryOpts) : string[];

    // write a key-value pair to the database, which will be signed by your author key.
    set(itemToSet : ItemToSet) : boolean;

    // try to import an item from another KeywingStore.
    ingestItem(item : Item) : boolean;

    // basic sync algorithm.  a faster one could be made later.
    _syncFrom(otherKeywing : IKeywingStore, existing : boolean, live : boolean) : number;
    sync(otherKeywing : IKeywingStore, opts? : SyncOpts) : SyncResults;
}

// Create a database for a particular workspace
let kw = new KeywingStoreMemory('gardening-pals');

// Make up some authors for testing
let keypair1 = generateKeypair();  // { public, secret } as base64 strings
let keypair2 = generateKeypair();
let author1 = addSigilToKey(keypair1.public); // "xxx" => "@xxx.ed25519"
let author2 = addSigilToKey(keypair2.public);

// It's a key-value store.  Keys and values are strings.
kw.set('wiki/Strawberry', 'Tasty', author1, keypair1.secret);
kw.getValue('wiki/Strawberry') // --> 'Tasty'

// One author can use multiple devices with no problems.
// Conflicts are resolved by timestamp.
// Here the same author overwrites their previous value,
// which is forgotten from the database.
kw.set('wiki/Strawberry', 'Tasty!!', author1, keypair1.secret);
kw.getValue('wiki/Strawberry') // --> 'Tasty!!'

// Multiple authors can overwrite each other (also by timestamp).
kw.set('wiki/Strawberry', 'Yum', author2, keypair2.secret);
kw.getValue('wiki/Strawberry') // --> 'Yum'

// We keep the one most recent value from each author, in case
// you need to do better conflict resolution later.
// To see the old values, use a query:
kw.values({ key='wiki/Strawberry', includeHistory: true })
    // --> ['Yum', 'Tasty!!']  // newest first

// Get more context about an item, besides just the value.
kw.getItem('wiki/Strawberry')
/* {
    schema: 'kw.1',
    workspace: 'gardening-pals',
    key: 'wiki/Strawberry',
    value: 'Yum.',
    author: '@author2.ed25519',
    timestamp: 1503982037239,  // it's microseconds: Date.now()*1000
    signature: 'xxxxxxxx.sig.ed25519',
} */

// WRITE PERMISSIONS
//
// Keys can specify which authors are allowed to write to them.
// Author names who occur within parens can write.
// Like '(@aaa.ed25519)/about'  -- only @aaa can write here.
// You can also put several authors and they will all have write permissions: '(@a)(@b)(@c)/whiteboard'
// If there are no parens, the key can be written to by anyone in the workspace.
kw.set('(' + author1 + ')/about', '{name: ""}', author1, keypair1.secret);

// Coming soon, the workspace can also have members with
// read or read-write permissions in general.

// Values are just strings.
// If you want JSON, you have to parse/stringify it yourself.
// If you want to store binary data, you should base64-encode it.
// To delete a message, maybe set it to "null" if you expect it to be JSON.
// This may improve later.

// You can do the usual key-value things.
kw.keys()
kw.keys({ lowKey: 'abc', limit: 100})
kw.keys({ prefix: 'wiki/'})

// You can sync to another KeywingStore!
let kw2 = new KeywingStoreMemory();
kw.sync(kw2);
// Now kw and kw2 are identical.

//------------------------------
// Upcoming features

// Soon you can provide some queries and only sync items matching
// one or more of those queries.
kw.sync(kw2, [
    { prefix: 'about/' },
    { prefix: 'wiki/' },
]);

// Soon you can subscribe to changes from a KeywingStore:
kw.onChange(cb);  // -> new data events, changed data events

// Soon you can control who can join, read, and write in a workspace, but details TBD.

// Soon: you can add metadata on each item to help with querying.
// This will provide a general-purpose way of querying so apps don't
// have to index messages themselves.
/* {
    schema: 'kw.1',
    workspace: 'gardening-pals',
    key: 'wiki/Strawberry',
    value: 'Yum.',
    author: '@author2.ed25519',
    timestamp: 1503982037239,  // it's microseconds: Date.now()*1000
    signature: 'xxxxxxxx.sig.ed25519',
    metadata: {
        // key-values, any strings
        'mimetype': 'text',
        'type': 'wiki',
        'wiki-category': 'berries',
        ...
    },
} */
```
----
## Details

### Classes
* A KeywingStore is responsible for holding and querying the data.
* So far there's an in-memory implementation.
* Next up will be SQLite, leveldb, IndexedDB?
* The zoo of classes will eventually be:
    * KeywingStore -- store and query the data
    * KeywingHTTPSyncer -- run HTTP server, and sync over HTTP
    * KeywingStreamSyncer -- sync over a duplex stream
    * KeywingPeerFinder -- find peers and connect to them
    * KeywingEncryptedStore -- make it easier to store encrypted items
    * your app -- tell Keywing which data and which peers you are interested in so it knows what to fetch

### Planned features:
* Workspaces - Like a Slack workspace / Discord server / scuttleverse.  Control who joins, block people, invitations, etc.
* Encryption - Wrap items in an encrypted envelope.  They will still sync without being understood by middle-people.
* Metadata - Each item can have its own small k-v metadata, which can help us query for things.  KeywingStore will be responsible for indexing it.  The goal is simple general purpose indexing so apps don't need their own indexes.
* Namespaces? - Within a workspace, like top-level folders, to more easily control what to sync and keep different apps from stepping on each others' data.

### Items table schema
```
{
    schema: 'kw.1'  // for future updates
    workspace: utf-8 string, no '\n'
    key: utf-8 string, no '\n'
    value: utf-8 string
    timestamp: int in microseconds (milliseconds * 1000)
    author pubkey: ascii string, no '\n'
    signature by author: ascii string, no '\n'
}
primary key: (key, author) -- one item per key per author.
```

### All about keys
* are kind of like file paths
* requirements:
    * utf-8
    * don't contain `\n`
    * empty string is not allowed
    * parens have special meaning (for author write permissions)
    * any other valid utf-8 is ok
    * TODO: or should we limit to ascii to avoid unicode normalization attacks?
* recommendations:
    * preferred to use url-safe characters `'()-._~$&+,/:;=?@` so browsers won't percent-escape them
    * be aware using `/` will affect links in the browser (e.g. your content within a wiki) - you may need to set a <base> path.
    * preferred to not start with `/`, for consistency.
* max length: ? has to be pretty long to allow several authors to have write permissions

### Key permissions
* a key is writable by an author if their key appears in curly brackets
* a key which contains no parens is publicy writable
* if it contains at least one paren `(` or `)`, it has limited permissions
* if it contains multiple authors `(@a)(@b)`, they can all write
```
(@a)/follows/@b        // only @a can write to this key
(@a)(@b)/wiki/cucumber   // @a and @b can write here
rooms/gardening/members/(@a)   // it can go at the end, or anywhere
public/foo   // no curly brackets, so anyone can write here
```

### Encoding of crypto keys, signatures, etc
* TODO: choose an encoding
* goals: URL safe, filename safe, no punctuation for easy doubleclicking, not case sensitive, widely supported by stdlibs, easy to implement, short enough for url location component (63 chars), sigils make sense, easy to regex, works as a link in markdown, works well in HTML
* base64url
    * https://github.com/commenthol/url-safe-base64#readme
* base58check - used by Bitcoin and IPFS
    * multibase - https://github.com/multiformats/multibase
* base32
* https://tools.ietf.org/html/rfc4648 - base 16, 32, 64
* sigils
    * author: `'@' + baseXX(pubkey) + '.ed25519'`
    * signature: `baseXX(sig) + '.sig.ed25519'`
    * pointer to a key: ?
    * pointer to a specific key version: `hash(message)`?
    * blobs are not used in this system.  Put your blobs under the key `blobs/xxxx` or something.

### Signatures
Item hashes are used within signatures and to link to specific versions of an item.

There's a simple canonical way to hash an item: mostly you just concat all the fields in a predefined order:
```
    sha256([
        item.schema,
        item.workspace,
        item.key,
        sha256(item.value),
        '' + item.timestamp,
        item.author,
    ].join('\n'));
```
None of those fields are allowed to contain newlines (except value, which is hashed for that reason) so newlines are safe to use as a delimiter.

To sign a item, you sign its hash with the author's secret key.

Note that items only ever have to get transformed INTO this representation just before hashing -- we never need to convert from this representation BACK into a real item.

There is no canonical "feed encoding" - only the canonical way to hash an item, above.  Databases and network code can represent the item in any way they want.

The hash and signature specification may change as the schema evolves beyond `kp.1`.  For example there may be another schema `ssb.1` which wraps and embeds SSB messages and knows how to validate their signatures.

### To validate incoming items:
* check all the fields exist, have correct data types and no `\n`
* check signature
* check valid key string (no `\n`, etc)
* check write permission of key by author
* timestamp must be not too far in the future (10 minutes?)
    * skip individual items when timestamp is in the future
    * maybe next time we sync that item will be allowed by then

### To ingest to database:
* compare to existing newest item for the same key
* check if it's newer by timestamp
* if older, ignore it
* if timestamps are equal, keep the one with lowest signature to break ties
* replace old value from same author, same key
* keep one old value from each different author in a key
    * (to help revert vandalism of publicly writable keys)
```
INSERT OR REPLACE INTO items
WHERE key=:key
AND author=:author
```

Read a key:
```
SELECT * FROM items
WHERE key=:key
ORDER BY timestamp DESC, signature ASC
LIMIT 1
```
* return undefined if not found

### Write a (key, value):
* remember we're using microseconds, Date.now()*1000
* set timestamp to `max(now, key's highest existing timestamp + 1)` so we are the winner
* sign
* ingest
* TODO: consider using same timestamp to indicate batch writes (transactions)

When the app wants to delete a key:
* write it the usual way using `"null"` as the value
* this acts as a tombstone
* this tombstone value may be app-dependent, it's not part of the core keywing spec (TODO?)
* tombstones will be returned from queries just like other values

### Sync over duplex streams:
Here's a very simple but inefficient algorithm to start with:
```
    sort keys by (key, timestamp DESC, signature ASC)
    filter by my interest query
    while true:
        both sides send next 100 items to each other as (key, timestamp, signature)
        both sides figure out what the other needs and send it in full
        both sides send 'ok'
```

### Sync over HTTP when only one peer is publicly available:
Here's a very simple but inefficient algorithm to start with:
```
    the client side is in charge and does these actions:
    sort keys by (key, timestamp DESC, signature ASC)
    filter by my interest query
    GET /interest-query   the server's interest query
    while true:
        GET /item-versions?after='foo/bar'&limit=100 from server
        compare with my own items
        pull things I need
            POST /batch-get-items       keys=[foo, foo/a, foo/b, ...]
        push things they need:
            POST /batch-ingest-items    items=[ {...}, {...} ]
```

Note that everything happens in batches instead of infinite streams.  The code avoids using streams.

### HTTP API
Coming soon:
```
HTTP replication:

GET /interest-query   the server's interest query
    return a list of query objects -- what does the server want?
GET /item-versions [after='...'] [limit=100] [before='...']
    return array of items with just key, version, first N bytes of signature
POST /batch-get-items       keys=[foo, foo/a, foo/b, ...]
    return complete items
POST /batch-ingest-items    items=[ {...}, {...} ]
    ask server to write these items
    return 'ok' or error
```

# TODO

### Encoding of values:
* Currently everything is a utf8 string
* Do we want to make it easier to hold other things, and encode/decode for the user?
* Maybe a prefix:
```
b:....  binary as base64
u:....  utf-8
j:....  json
t:      tombstone for deleted items
```

### Key shorthand
* Use these special values in a key
* Signatures are based on the shorthand key
* Upon ingestion to the db, the values get replaced like a template string
* Database lookups use the full expanded key
* Across the network we only need to send the shorthand key
```
(@) for my own author pubkey, to save space
(hash) for the hash of this message, to make immutable items
```
* `(hash)` lets you create items that can never be overwritten, because you can never make another item with the same hash.
    * ...if we make it use a character that's forbidden in regular keys

### Key overlays?
* It would be easy make an overlay view of different key prefixes ("folders") within a Keywing
* Or overlay two Keywing instances
* For example you can combine `{@a}/wiki` and `{@b}/wiki` into one namespace
