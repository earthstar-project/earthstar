# Earthstar concepts and vocabulary

Earthstar is an:
* eventually consistent
* offline-first
* embedded
* NoSQL document database
* that syncs.

It...
* can sync peer-to-peer and peer-to-server
* can sync across untrusted peers
* uses cryptographic signatures to prevent data tampering

# Author

An author is a person identified by a public key.  This is a "user account".

A person can use the same author name and key from multiple devices.

```
    AUTHOR ADDRESS
    |------------------------------------------------|
     SHORTNAME (4 chars)
          PUBLIC KEY (ed25519 as base58, 44 chars)
     |--| |-----------------------------------------|
    @suzy.6efJ8v8rtwoBxfN5MKeTF2Qqyf6zBmwmv8oAbendBZHP

    LONGNAME: any length, any characters
    This is stored at the path "/about/~@suzy.6efJ8.../name"
      Susan ✨
```

**Shortnames** are exactly 4 characters long with only lower case ASCII letters.  They can't be changed later.  They help protect against phishing attacks.

Authors also have human-readable **long names** which are saved as regular documents along with other profile information, and can contain any characters.  They can be changed.  This is like a "display name" in Slack or Twitter.

# Workspace

A workspace is a collection of **documents** that can be accessed by certain **authors**.

There are 2 kinds of workspaces:

**Unlisted** workspaces can be written by anyone, if they know the workspace address.  The address has a 20-character random number at the end to make it hard to guess.

**Invite-only** workspaces have a public key at the end.  They can only be written to by authors who know the matching private key.  Anyone can still sync and read the data, but authors can choose to encrypt their documents using the workspace key so only workspace members can read them.

```
UNLISTED WORKSPACE:

   WORKSPACE ADDRESS
   |-----------------------------|
    NAME       RANDOM NUMBER (20 chars)
    |--------| |-----------------|
   +gardening.mVkCjHbAcjEBddaZwxFV


INVITE-ONLY WORKSPACE:

   WORKSPACE ADDRESS
   |----------------------------------------------------|
    NAME      PUBLIC KEY (44 chars)
    |-------| |-----------------------------------------|
   +gardening.mVkCjHbAcjEBddaZwxFVSiQdVFuvXSiH3B5K5bH7Hcx

   WORKSPACE SECRET KEY:
   489pP5qqRNPvKWmWrsUT4XEhkRmLi7D7RKNGL2QwcZo4
```

**Workspace names** are short strings containing 1 to 15 lower-case ASCII letters.


# Document

A document is a JSON-style object with the following shape:
```
{
    format: 'es.3',
    workspace: '+gardening.xxxxx',

    path: '/wiki/Bumblebee',
    value: 'Bumblebees are flying insects...',

    timestamp: 12345000000000,  // microseconds
    author: '@suzy.6efJ8...',
    authorSignature: 'xxxxxxx',

    workspaceSignature?: 'xxxxxxx',  // only present in invite-only workspaces
}
```

## Format

This string identifies the **feed format** or schema used by Earthstar.  It controls the rules used to validate signatures and documents.  The format is versioned to help preserve old data.

## Path

A string identifying this document like a path in a filesystem.

Must start with `/` and can contain numbers, letters, and these characters:
```
/'()-._~!*$&+,:=?@%
```
Case sensitive.  No spaces.  No unicode characters or unprintable ASCII.  Use percent-encoding to embed other characters.

Typically the first folder component of the path represents the type of document, or the application used to make it.  When syncing data you can choose which paths to replicate (like `/wiki/*`).

## Value

User data goes here.  Currently this only allows strings; it will be expanded to allow JSON-style nested objects.

## Timestamp

Timestamps are in Unix microseconds.  Javascript measures time in milliseconds, so multiply by 1,000 to get microseconds.  If you have seconds, multiply by 1,000,000.

Authors set the timestamps themselves so we can't trust them completely.  During sync, documents with timestamps too far in the future are skipped (not accepted or stored).  This prevents authors from faking future timestamps and spreading them through the network.  However, authors are able to choose old timestamps.

## Writing documents

Documents are **mutable**.  You can overwrite them with newer versions.

You can't truly delete a document -- it will persist as a tombstone -- but you can overwrite it with any value you like, such as an empty string.

## Path ownership

Authors can **own** certain paths, which means that only they can write there.

If a path contains an author address prefixed with a tilde, only that author can write to that path.
```
/about/~@suzy.6efJ8v8rtwoBxfN5MKeTF2Qqyf6zBmwmv8oAbendBZHP/name
```

If it contains multiple such tilde-authors, any of them can write.
```
/groupchat/~@aaaa.1a1a1a1a~@bbbb.2b2b2b2b2b/description
```

Paths with no tildes are **shared** paths with no owners, and anyone in the workspace can write there:
```
/todo/get-milk
```

## Document History

Each document has a history of old versions.  Earthstar keeps one latest version from each author.  Older versions are forgotten.

# Query

You can retrieve documents in several ways:
1. Listing all paths, sorted by path
1. Getting all documents, sorted by path
2. Getting the document at one specific path
3. Querying

To query, you supply a query object:
```
{
    // An empty query object returns all keys.
    // Each of the following adds an additional filter,
    // narrowing down the results further.

    key?: string,  // one specific key only.

    lowKey?: string,  // lowKey <= k
    highKey?: string,  // k < highKey

    prefix?: string,  // keys starting with prefix.

    limit?: number,  // there's no offset; use lowKey as a cursor instead

    author?: AuthorKey

    // include old versions of this item from different authors?
    includeHistory?: boolean, // default false
}
```

# Pub servers

A pub is a server that helps sync workspaces.  It holds a copy of the data and sits at a publically accessible URL, usually on a cloud server.

Pubs have regular HTTP style URLs:
```
https://mypub.com
```

Pubs can be configured to accept any workspace that's pushed to them, or they can have allowlists or blocklists to limit which workspaces they'll host.

A workspace can be hosted by multiple pubs.

Pubs have no authority over users, they just help sync data.

# Finding your friends

There is no centralized discovery or friend-finding system.

To join a workspace you need to know:
* The workspace address: `+gardening.mVkCjHbAcjEBddaZwxFV`
* The workspace private key, if it's an invite-only workspace
* One or more pubs that people in that workspace are using, so you can sync

Users are expected to share their workspace addresses and pubs with each other outside of Earthstar, such as by email or chat.

# URLs and URIs

Here's how to combine different kinds of Earthstar addresses.  In this documentation, `xxxxx` is an abbreviation for long keys.
```
GENERAL FORMAT:
    PUB "/" WORKSPACE "/" AUTHOR "/" PATH

Workspace
    +gardening.xxxxx

Path
    /wiki/shared/Bumblebee

Author
    @suzy.xxxxx

Workspace + Path
    +gardening.xxxxx/wiki/shared/Bumblebee

Workspace + Author
    +gardening.xxxxx/@suzy.xxxxx

Pub base URL (usually holds a human-readable webpage about the pub)
    https://mypub.com

Pub + Workspace
    https://mypub.com/+gardening.xxxx

Pub + Workspace + Path
    https://mypub.com/+gardening.xxxx/wiki/shared/Bumblebee

Pub + Workspace + Author
    https://mypub.com/+gardening.xxxx/@suzy.xxxxx

Pub + Workspace + Sync API
    https://mypub.com/earthstar-api/v1/...
```

TODO: how to link to a specific version of a document?

# Classes

This is specific to the Javascript implementation; other libraries might have different internal structures.

![](building-blocks.png)

# Replication / Syncing

These are two words for the same thing - trading data with other peers to bring each other up to date.  This can be one-way (push or pull), or two-way.

## Incoming and Outgoing Replication Queries

A peer's **Incoming** Replication Queries specify which data it wants from other peers.

Its **Outgoing** Replication Queries control which data it will give to other peers.

Both of these are lists of Query objects.  Adding more clauses inside a Query object narrows down the results (logical AND).  Adding more Query objects to the list broadens the results (logical OR).

```
// What do we want from other peers?
//  Get all /about/* documents,
//  recent /wiki/* documents,
//  and everything by me
syncer.incomingReplicationQueries = [
    { prefix: '/about/' },
    { prefix: '/wiki/', timestampAfer: 123450000000 },
    { author: '@suzy.xxxxx' },
]

// What should we give to other peers?
//  Only upload my own documents
syncer.outgoingReplicationQueries = [
    { author: '@suzy.xxxxx' },
]
```

## Transactions, data integrity

There are no transactions or batch writes.  The atomic unit is the document.  If you update 2 documents at the same time, it's possible that peers will end up with just one of the updates -- because of an interrupted sync, or because one was filtered out by a replication query.

If certain pieces of state need to always be updated together, you can just design them to be part of the same document.  But there's a tradeoff -- larger documents are more likely to have conflicts when multiple people edit at the same time.  Smaller documents let people make narrower changes that sync together easily.

## Conflict resolution

Earthstar does not have fancy conflict resolution.

Each document has a history of old versions.  Earthstar keeps one version from each author.  Older versions are forgotten.

When fetching a path, the latest version is returned (by author-asserted timestamp).  You can also get all versions if you want to do manual conflict resolution.

![](earthstar-data-model.png)

Note that this image is simplified.  A real document looks like this:

```
{
  "format": "es.3",
  "workspace": "+gardening.xxxxxxxxxxxxxxxxxxxx",
  "path": "/wiki/shared/Bumblebee",
  "value": "Buzz buzz buzz",
  "author": "@suzy.E4JHZTPXfc939fnLrpPDzRwjDEiTBFJHadFH32CN97yc",
  "timestamp": 1593389751898000,
  "signature": "wUkbUbGuwdZ4sbj53BQC2Yqeb55w2ZGX25qgTrkfvfqAR8f7qKpe2cAEGeD7ZwEZjCtgPaZoNoYeKf3NG3SBBP9"
}
```
