# Earthstar

[Earthstar](https://earthstar-project.org) is a small and resilient distributed
storage protocol designed with a strong focus on simplicity and versatility,
with the social realities of peer-to-peer computing kept in mind.

This is a reference implementation written in Typescript. You can use it to add
Earthstar functionality to applications running on servers, browsers, the
command line, or anywhere else JavaScript can be run.

[Detailed API documentation for this module can be found here](https://doc.deno.land/https://deno.land/x/earthstar@v10.0.1/mod.ts).

This document is concerned with the usage of this module's APIs. To learn more
about what Earthstar is, please see these links:

- [What is Earthstar?](https://earthstar-project.org/docs/what-is-it)
- [How does Earthstar work?](https://earthstar-project.org/docs/how-it-works)

To learn more about running Earthstar servers, see
[README_SERVERS](README_SERVERS.md)

To learn more about this codebase, please see [ARCHITECTURE](ARCHITECTURE.md).

To learn about contributing to this codebase, please see
[CONTRIBUTING](CONTRIBUTING.md).

## Table of contents

## Importing the module

It can be imported via URL into a browser:

```html
<script type="module">
  import * as Earthstar from "https://cdn.earthstar-project.org/js/earthstar.web.v10.0.1.js";
</script>
```

Or Deno:

```ts
import * as Earthstar from "https://deno.land/x/earthstar/mod.ts";`}
```

> Earthstar's web syncing does not work with version of Deno between 1.27.0 -
> 1.29.3 (inclusive) due to a regression in these versions' WebSocket
> implementation. **Use Deno 1.30.0. or later**, or Deno 1.26.2.

or installed with NPM:

```bash
{`npm install earthstar`}
```

We recommend the browser and Deno versions. This module has been built with many
standard web APIs that have need to be polyfilled to work in Node.

## Instantiating a replica

`Replica` is the central API of this module. It is used to write and read data
to a locally persisted copy of a share's data, and much more besides.

To instantiate a replica, you will need knowledge of a share's public address.

```ts
import { Replica, ReplicaDriverMemory } from "earthstar";

const replica = new Replica({
  driver: ReplicaDriverMemory(YOUR_SHARE_ADDRESS),
  shareSecret: YOUR_SHARE_SECRET,
});
```

The `shareSecret` property is optional. If we omit it, the replica will be
read-only.

### Generating share keypairs

You can create new shares whenever you want.

```ts
import { Crypto } from "earthstar";

const shareKeypair = await Crypto.generateShareKeypair("gardening");
```

The result of this operation will either be a `ShareKeypair` object with
`shareAddress` and `secret` properties, or a `ValidationError`.

### Persisting data with drivers

`Replica` must always be instantiated with a driver. These drivers tell the
`Replica` how to store and retrieve data, with different drivers using different
storage mechanisms.

Here are the available drivers:

- `ReplicaDriverMemory` (works in all environments, but only stores data in
  memory)
- `ReplicaDriverWeb` (works in the browser, stores data with IndexedDB)
- `ReplicaDriverFs` (works on runtimes with filesystem access, stores data with
  Sqlite and the filesystem)

Drivers are made of two sub-drivers: one for documents, and one for attachments
(arbitrary binary data).

There are some extra document drivers not used in the default drivers:

- `DocDriverLocalStorage` (works in runtimes supporting the WebStorage API)
- `DocDriverSqliteFFI` (works in Deno, stores data with a FFI implementation of
  Sqlite, requires using the `--unstable` flag, and is faster than the default
  driver in `ReplicaDriverFs`)

These document drivers can be used like this:

```ts
const driver: IReplicaDriver = {
  docDriver: new DocDriverSqliteFfi(SHARE_ADDR, FS_PATH),
  attachmentDriver: new AttachmentDriverFs(FS_ATTACHMENTS_PATH),
};

const replica = new Replica({ driver });
```

## Writing data

Writing data requires two things:

- A replica configured with a valid share secret
- An author keypair

Author keypairs can be generated like this:

```ts
import { Crypto } from "earthstar";

const authorKeypair = await Crypto.generateAuthorKeypair("suzy");
```

The result will be a new `AuthorKeypair` object with `address` and `secret`
properties, or a `ValidationError`.

With a valid author keypair you can write data using `Replica.set`:

```ts
const setResult = await replica.set(authorKeypair, {
  path: "/my-note",
  text: "Saw seven magpies today",
});
```

The result of this operation is either an `IngestEvent` describing the
operation's success (or failure, if one of the parameters was invalid in some
way).

## Wiping data

Once written, data can be removed by overwriting it:

```ts
await replica.set(authorKeypair, {
  path: "/my-note",
  text: "",
});
```

Or with the convenience method:

```ts
await replica.wipeDocAtPath(authorKeypair, "/my-note");
```

### Creating ephemeral documents

There is another way to remove written data without leaving any trace of it.

Ephemeral documents are held by replicas until a specified time, until at which
point they are deleted.

```ts
await replica.set(authorKeypair, {
  path: "/my-temporary-note!",
  text: "I accidentally stepped on the strawberries.",
  deleteAfter: TIME_IN_MICROSECONDS,
});
```

To set an ephemeral document, the path _must_ contain a `!`, and the
`deleteAfter` property must be set with a timestamp in _microseconds_.

## Querying data

There are many ways to get data back out of a Replica. The simplest one is
`Replica.getAllDocs`:

```ts
const everything = await replica.getAllDocs();
```

The most powerful is `Replica.queryDocs`:

```ts
const mostRecentlyEditedWikiPageDocs = await replica.queryDocs({
  historyMode: "latest",
  filter: {
    pathStartsWith: "/wiki",
  },
  limit: 10,
});
```

Here are all the querying methods on `Replica`:

- `getAllDocs`
- `getLatestDocs`
- `getAllDocsAtPath`
- `getLatestDocAtPath`
- `queryDocs`
- `queryPaths`
- `queryAuthors`

Detailed API documentation for all of them can be found
[here](https://doc.deno.land/https://deno.land/x/earthstar/mod.ts).

## Using document contents

The documents returned by queries are plain objects with the following shape:

```ts
type Doc = {
  /** Which document format the doc adheres to, e.g. `es.5`. */
  format: "es.5";
  author: AuthorAddress;
  text: string;
  textHash: string;
  /** When the document should be deleted, as a UNIX timestamp in microseconds. */
  deleteAfter?: number;
  path: Path;
  /** Used to verify the authorship of the document. */
  signature: Signature;
  /** Used to verify the author knows the share's secret */
  shareSignature: Signature;
  /** When the document was written, as a UNIX timestamp in microseconds (millionths of a second, e.g. `Date.now() * 1000`).*/
  timestamp: Timestamp;
  /** The share this document is from. */
  share: ShareAddress;
  /** The size of the associated attachment in bytes, if any. */
  attachmentSize?: number;
  /** The sha256 hash of the associated attachment, if any. */
  attachmentHash?: string;
};
```

Though most applications will probably only use the `author`, `text`, and
`timestamp` properties.

## Syncing with other peers

Syncing data with other peers requires adding your replica(s) to an instance of
`Peer`:

```ts
import { Peer } from "earthstar";

const peer = new Peer();

// Pretend myReplica is an instance of `Replica`
peer.addReplica(myReplica);

peer.sync("https://my.server");
```

`Peer.sync` can be passed another instance of `Peer` or a valid URL of an
Earthstar server to sync with.

The two peers will only sync the replicas with shares they have in common.

The result of `Peer.sync` can be assigned and used to monitor the progress of
the sync operation:

```ts
const syncer = peer.sync("https://my.server");

syncer.onStatusChange((newStatus) => {
  console.log(newStatus);
});

syncer.isDone().then(() => {
  console.log("Sync complete");
}).catch((err) => {
  console.error("Sync failed", err);
});
```

## Using document attachments

Documents can be written along with some arbitrary data which is persisted as an
'attachment'. Whereas a document's `text` field can hold a UTF-8 string of 8kb,
attachments can be of any kind of data and of any size.

```ts
// Here we use Deno.readFile to get a file's contents as a Uint8Array
const imageData = await Deno.readFile("/Desktop/leaf.jpg");

await replica.set(authorKeypair, {
  path: "/images/pear-leaf.jpg",
  text: "A close-up of a leaf of a pear tree",
  attachment: imageData,
});
```

The path _must_ have a file extension e.g. `.jpg`, `.mp3` if it also has an
attachment.

If we were attaching a large amount of data, we would use a `ReadableStream`
instead:

```ts
// Here we use Deno.readFile to get a file's contents as a ReadableStream<Uint8Array>
const videoFile = await Deno.open("/Desktop/little-mole.mp4");

await replica.set(authorKeypair, {
  path: "/videos/little-mole.mp4",
  text: "A close-up of a leaf of a pear tree",
  attachment: videoFile.readable,
});
```

### Retrieving attachments

If you already have a document with an attachment, you can use
`Replica.getAttachment`:

```ts
const attachment = await replica.getAttachment(docWithAttachment);
```

The result of this operation will be a `DocAttachment` with `getBytes` and
`getStream` methods, undefined (if our replica has not received a copy of this
attachment from other peers), or a `ValidationError` in case `getAttachment` was
passed a document which can't have an attachment.

It's also possible to add attachments to many documents at once:

```ts
const allDocs = await replica.getAllDocs();

const allDocsWithAttachments = await replica.addAttachments(allDocs);
```

`allDocsWithAttachments` will be an array of all documents with an added
`attachment` property. The type of this property will either be `DocAttachment`,
`undefined`, or `ValidationError`.

## Subscribing to replica changes

There are many ways to subscribe to the many events a replica generates during
its lifetime.

If you want to subscribe to updates in order to update a UI, the most ergonomic
API is `ReplicaCache`:

```ts
import { ReplicaCache } from "earthstar";

const replicaCache = new ReplicaCache(myReplica);

const allDocs = replicaCache.getAllDocs();
```

The caveat is that the first time a query method is called, it _always_ returns
an empty result. To get new updates, you must subscribe to changes. In the
following example, we build a UI with a fictitious `renderDocListUI` function
with the results of `ReplicaCache.getAllDocs`:

```ts
function triggerUIRender() {
  const allDocs = replicaCache.getAllDocs();

  renderDocListUI(allDocs);
}

replicaCache.onCacheUpdated(() => {
  triggerUIRender();
});

triggerUIRender();
```

The important thing to remember is that the callback to `onCacheUpdated` will
never trigger until the cache has been queried at least once.

If you're not tracking changes for a UI, `Replica.getQueryStream` returns a
`ReadableStream` of `QuerySourceEvent`, for documents matching a specific query.
This API is great for creating indexes.

```ts
// Create a query stream for all docs with paths starting with /chat
// And include all existing documents and all newly created or synced documents
const chatMessagesStream = replica.getQueryStream({
  filter: { pathStartsWith: "/chat" },
}, "everything");

chatMessagesStream.pipeTo(
  new WritableStream({
    write(event) {
      if (event.kind === "success" || event.kind === "existing") {
        console.log(event.doc.text);
      }
    },
  }),
);
```

Finally, `Replica.getEventStream` returns a `ReadableStream` of `ReplicaEvent`,
which includes events for new document ingestions, document expirations,
attachment ingestions, attachment prunes, and events for when the replica is
about to close (and has closed).

## Using common settings between clients

There are a number of configurations which most Earthstar applications will want
to persist between runs:

- The shares used
- An author to using for signing documents
- Servers to sync with

Earthstar offers a `SharedSettings` API which persists settings for these
between sessions in all runtimes supporting the WebStorage APIs:

```ts
const settings = new SharedSettings();

settings.author = authorKeypair;
settings.addShare(myShareAddress);
console.log(settings.servers);
```

It also offers a method which instantiates a new `Peer` with replicas for all
shares already added:

```ts
const settings = new SharedSettings();

// Create a peer with all saved shares and sync once with all saved servers.
const peer = settings.getPeer({
  sync: "once",
  onCreateReplica: (addr, secret) => {
    return new Replica({
      driver: new ReplicaDriverMemory(addr),
      shareSecret: secret,
    });
  },
});
```

## Checking for errors

Many functions in Earthstar return errors like `ValidationError`. These errors
are not thrown, so it's good to check for them:

```ts
import { isErr } from "earthstar";

const result = replica.set(authorKeypair, {
  path: "/hey",
  text: "Hello",
});

if (isErr(result)) {
  console.error(
    "Something went wrong when you tried to write some data!",
    result,
  );
}
```

## Changing the cryptographic driver

The Deno and browser versions of this module are configured by default to use
the fastest cryptographic libraries available to them. The Node version is not,
however.

```ts
import { setGlobalCryptoDriver } from "earthstar";
import { CryptoDriverChloride } from "earthstar/node";

setGlobalCryptoDriver(CryptoDriverChloride);
```
