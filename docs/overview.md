# Earthstar: Overview

![earthstar logo in purple](&Ev1N+Y27COw+fxOlfgeDN2WKL7vBsC1pM12bHpae6wU=.sha256)

A distributed p2p database / app toolkit that syncs.  Halfway in between SSB and CouchDB.

---

|                             | SSB                         | Earthstar              | CouchDB            |
|-----------------------------|-----------------------------|------------------------|--------------------|
| data model                  | append-only log of messages | key-value database     | key-value database |
| sync method                 | get log in order            | set replication        | ?                  |
| authors are...              | ✅ identified by pubkey      | ✅ identified by pubkey | 🚫 not identified   |
| messages are                | ✅ signed                    | ✅ signed               | 🚫 not signed       |
| safe with untrusted peers   | ✅ yes                       | ✅ yes                  | 🚫 no               |
| immutability                | ✅ yes                       | ✅ yes                  | 🚫 no               |
| hash backlinks              | ✅ yes                       | 🚫 no                   | 🚫 no               |
| proof of complete feed      | ✅ yes                       | 🚫 no                   | 🚫 no               |
| mutability, deletion        | 🚫 no                        | ✅ yes                  | ✅ yes              |
| multiple devices per author | 🚫 no                        | ✅ yes                  | ✅ yes              |
| partial replication         | 🚫 not really                | ✅ yes                  | ✅ yes              |

---

## Goals

* Simple enough to implement in a week with minimal dependencies
* Use boring technology and common paradigms like HTTP
* Provide building blocks for good social network usability: access control, deletion, mutability, multi-device, multi-author, partial replication, encryption

## Progress so far

* ✅ Standardized message format
* ✅ [Reference implementation in Typescript](https://www.npmjs.com/package/earthstar)
    * Storage: ✅ in-memory, ✅ sqlite, ⏳ indexeddb,
    * ✅ Message validation.  This is modular and can support multiple formats at once.
    * ✅ Pub-style HTTP server
    * ✅ Command line helper tool
    * A sync algorithm (✅ working, ⏳ effecient)

## How does it work?

* An Earthstar database holds key-value pairs.
* Put these databases all over the place -- in the browser, in cloud servers, in native apps
* They all sync with each other over HTTP or duplex streams
* They can do partial sync, drop older data, etc.

Users are identified with public keys, just like SSB.

Peers find each other in a variety of ways: by talking to cloud servers (like SSB pubs), or over hyperswarm or libp2p, bluetooth, trading USB drives, whatever you like.  This part is not standardized.

Data and users are grouped into independent `workspaces` (like a Slack workspace, or SSB's scuttleverses, or separate DATs).  Earthstar is designed for both small closed workspaces where you want all the data, and large open workspaces where you only want data from your friends.

## Security and data guarantees

* ✅ Each message is signed by the author
* ⏳ End-to-end encryption is coming soon

Untrusted peers can help replicated data without modifying it.  The worst they can do is withhold specific key-value pairs without your knowlege.  If there are some trusted peers around, they will fill in the gaps for you.

Earthstar does not guarantee causal order or help you prove you have a complete set of messages.  You can add some of those things back in at the application level.

## Write permissions and merge conflicts

Write permission is encoded into each key using a tilde `~` as a marker.

* `wiki/kittens` - anyone can write here
* `~@aaa/about` - only @aaa can write here
* `~@aaa/follow/@bbb` - only @aaa can write here
* `whiteboard/~@aaa~@bbb` - both @aaa and @bbb can write here, and nobody else can

Conflicts may occur within a single key.

An author can be on multiple devices. Their most recent update wins (by timestamp) and old ones are discarded.  This allows mutability.

Conflicts from multiple authors are also resolved by timestamp but we keep one old value from each author, to allow manual conflict resolution later.

Earthstar is not designed for fancy conflict resolution.  It's best to design apps so they don't need it -- for example, let people add comments to something instead of editing it.

## Indexing

Hopefully apps won't need their own indexes because they can access data directly by key.  They can also choose to sync only certain keys to make sure they have data such as `about` info.
