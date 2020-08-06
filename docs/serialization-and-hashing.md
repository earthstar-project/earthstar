# Serialization and Hashing

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Contents**

- [(Caveat: binary vs text)](#caveat-binary-vs-text)
- [Hashing documents](#hashing-documents)
- [Network transport](#network-transport)
- [Storage](#storage)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->


There are 3 scenarios when we need to serialize documents to plain old bytes:

* Hashing
* Network
* Storage

They have different needs, and so we use different formats for them.

## (Caveat: binary vs text)

As of 2020-07-30, document contents must be utf-8 strings.  We don't support raw binary data yet.  Adding binary data will complicate these choices because e.g. JSON doesn't support it.

## Hashing documents

This is a **one-way** conversion, memory `-->` bytes.  We use this to do `sha256(bytes)` and get the unique hash of a document.  The hash is then used to make signatures.

It needs to be **very standardized**, so it should be simple, deterministic, and easy to implement in any language.  It can be extra simple because we never need to decode it.

**Good choice:**

Something extremely simple.  We (will soon) use this:

```js
// convert document into one big string
let serializedDoc = Object.entries(document)
        .sort()  // sort alphabetically by object key
        .filter(([key, val]) => key !== 'content' && key !== 'signature')
        .map(([key, val]) => '' + key + '\t' + val + '\n')
        .join('')
)
// hash it
let docHash = sha256(serializedDoc)
// sign it
let signedDoc = {
    ...document,
    signature: sign(keypair, docHash),
}
```

Simplified example, with extra spaces added for readability.

```
author  \t  @suzy.xxxxxxxxxxxx  \n
contentHash  \t  xxxxxxxxxxxxxxxxxx  \n
format  \t  es.4  \n
path  \t  /wiki/Kittens  \n
timestamp  \t  1234567890000  \n
workspace  \t  +gardening.xxxxxxxxxx  \n
```

Note that our `sha256` outputs a base32 encoded string.  See `encoding.ts` for the base32 details.

> **Details**
> 
> For this to be secure, none of the keys or fields are allowed to contain `\n` or `\t`.  We already enforce this elsewhere, except for the `content` field.  We also enforce that the object keys are all strings, and the object values are all strings or integers (no nested objects or arrays).  Finally, each particular key is limited to a consistent type (always integers or always strings.)
> 
> Because `content` can contain special characters, we use the `contentHash` instead (e.g. `sha256(content)`).
> 
> Using `contentHash` also lets us verify the document when the actual content is missing -- maybe the content is large and we only download it on demand, or maybe we deleted it for some reason.
>

**Bad choices for hashing serialization:**

* JSON (not deterministic enough)

## Network transport

This is a **two-way** conversion, memory `<-- -->` bytes

Earthstar doesn't have strong opinions about networking.  This format does not need to be standardized, but it's good to choose widely used familiar tools.

**Good choices**:

* JSON
* newline-delimited JSON for streaming lots of documents
* CBOR
* msgpack
* ...
* GraphQL (relies on JSON)
* REST
* gRPC?
* muxrpc (from SSB)

## Storage

This is a **two-way** conversion, memory `<-- -->` bytes

It does not need to be standardized; each implementation can use its own format.

It needs to support efficient mutation and deletion of documents, and querying by various properties.

It would be nice if this was an archival format (corruption-resistant and widely known).

**Good choices:**

* SQLite
* Postgres
* IndexedDB
* leveldb (with extra indexes)
* a bunch of JSON files, one for each document (with extra indexes)

**Bad choices:**

* One giant JSON file (too slow)
* flume, hypercore, other append-only logs (can't mutate documents)
