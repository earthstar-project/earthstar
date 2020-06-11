# Earthstar concepts and vocabulary

Earthstar is an:
* eventually consistent
* offline-first
* NoSQL document database
* that syncs.

It...
* can be replicated peer-to-peer and peer-to-server
* can be replicated across untrusted peers
* uses cryptographic signatures to prevent data tampering

# Workspace

A workspace is a collection of **authors** and **documents**.

There are 2 kinds:

**Unlisted** workspaces can be written by anyone, if they know the workspace address.  The address has a 20-character random number at the end (it's just a random number, not an encryption key).

**Limited** workspaces have a public key at the end.  They can only be written to by authors who know the matching private key.  Anyone can still sync and read the data, unless the authors have chosen to encrypt the data.

```
UNLISTED WORKSPACE:

   WORKSPACE ADDRESS
   |------------------------------|
     WORKSPACE NAME
               WORKSPACE RANDOM NUMBER
     |-------| |------------------|
   //solarpunk.mVkCjHbAcjEBddaZwxFV


LIMITED WORKSPACE:

   WORKSPACE ADDRESS
   |-----------------------------------------------------|
     WORKSPACE NAME
               WORKSPACE KEY
     |-------| |-----------------------------------------|
   //solarpunk.mVkCjHbAcjEBddaZwxFVSiQdVFuvXSiH3B5K5bH7Hcx

   WORKSPACE SECRET KEY:
   489pP5qqRNPvKWmWrsUT4XEhkRmLi7D7RKNGL2QwcZo4
```

**Workspace names** are short strings containing only lower case letters, numbers, and dashes.

# Author

An author is a person identified by a public key.

A person can use the same author name and key from multiple devices.

```
    AUTHOR ADDRESS
    |------------------------------------------------|
     AUTHOR SHORTNAME
          AUTHOR KEY
     |--| |-----------------------------------------|
    @suzy.6efJ8v8rtwoBxfN5MKeTF2Qqyf6zBmwmv8oAbendBZHP

    AUTHOR NAME: any length, any characters
    Susan ✨
```

**Shortnames** are exactly 4 characters long with only lower case letters and numbers.  They can't be changed later.  They help protect against phishing attacks.

Authors also have human-readable names which are saved as regular documents along with other profile information, and can contain any characters.  They can be changed.

# Document

A document is a JSON-style object with the following shape:
```
{
    format: 'es.1',
    path: '/wiki/shared/Dolphins',
    value: {
        // any user data goes in here
        text: 'Dolphins are aquatic mammals...',
    },
    timestamp: 12345000000000,
    author: '@suzy.6efJ8...',
    authorSignature: 'xxxxxxx',
    workspaceSignature?: 'xxxxxxx',  // only present in limited workspaces
}
```

## Writing documents

Documents are **mutable**.  You can overwrite them with newer versions.

TODO: You can't truly delete a document, but you can overwrite it with any value you like, such as `{deleted: true}`.

## History

Each document has a history of old versions.  Earthstar keeps one latest version from each author.  Older versions are forgotten.

## Format

This string identifies the **feed format** or schema used by Earthstar.  It controls the rules used to validate signatures and documents.

## Path

A string identifying this document like a path in a filesystem.

Must start with `/`.  Can contain numbers, letters, and these characters:
```
/'()-._~!*$&+,:=?@%
```
Case sensitive.  No spaces.  No unicode characters or unprintable ASCII.  Use percent-encoding to embed those characters.

Typically the first folder component of the path represents the type of document, or the application used to make it.  When syncing data you can choose which paths to replicate (like `/wiki/*`).

### Path ownership

Authors can **own** certain paths, which means that only they can write there.

If a path contains an author address prefixed with a tilde, only that author can write to that path.
```
/about/~@suzy.6efJ8v8rtwoBxfN5MKeTF2Qqyf6zBmwmv8oAbendBZHP/name
```

If it contains multiple such tilde-authors, any of them can write.
```
/groupchat/~@aaaa.01010101~@bbbb.7878787878/description
```

Paths with no tildes are **shared** paths with no owners, and anyone in the workspace can write there.

## Value

A JSON-style object holding arbitrary user data.

## Timestamp

Timestamps are in Unix microseconds.  In Javascript times are usually milliseconds, so multiply by 1,000 to get microseconds.  If you have seconds, multiply by 1,000,000.

Authors set the timestamps themselves so we can't trust them completely.  During sync, documents with timestamps too far in the future are skipped.  This prevents authors from faking future timestamps and spreading them through the network.  However, authors are able to choose old timestamps.

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

    author?: AuthorKey  // TODO: does this include the author's obsolete history items?

    // include old versions of this item from different authors?
    includeHistory?: boolean, // default false
}
```

# Pubs

A pub is a server that helps sync workspaces.  It holds a copy of the data and sits at a publically accessible URL.

Pubs have regular HTTP style URLs:
```
https://mypub.com
```

# URLs and URIs

Here's how to combine different kinds of Earthstar addresses.  In this documentation, `xxxxx` is an abbreviation for long keys.
```
GENERAL FORMAT:
    PUB "/" WORKSPACE "/" AUTHOR "/" PATH

Workspace
    //solarpunk.xxxxx

Path
    /wiki/shared/Dolphin

Author
    @suzy.xxxxx

Author + Path
    @suzy.xxxxx/wiki/shared/Dolphin

Workspace + Path
    //solarpunk.xxxxx//wiki/shared/Dolphin

Workspace + Author
    //solarpunk.xxxxx/@suzy.xxxxx

Workspace + Author + Path
    //solarpunk.xxxxx/@suzy.xxxxx/wiki/shared/Dolphin

Pub base URL (usually holds a human-readable webpage about the pub)
    https://mypub.com

Pub + Workspace
    https://mypub.com//solarpunk.xxxx

Pub + Workspace + Path
    https://mypub.com//solarpunk.xxxx//wiki/shared/Dolphin

Pub + Workspace + Author
    https://mypub.com//solarpunk.xxxx/@suzy.xxxxx

Pub + Workspace + Author + Path
    https://mypub.com//solarpunk.xxxx/@suzy.xxxxx/wiki/shared/Dolphin

Pub + Workspace + Sync API
    https://mypub.com/earthstar-api/v1/...
```

TODO: how to link to a specific version of a document?

# Classes

## Earthstar Peer

This is the overarching object that contains all of the following:

## Storage

A **Storage** is a database holding a single Earthstar workspace.

## Validator

A class that implements a **feed format**.

When you create a storage, you specify which feed formats you will allow it to hold.

## Syncer

A class whose job is to connect to other peers and sync data with them.

# Replication / Syncing

These are two words for the same thing - trading data with other peers to bring each other up to date.  This can be one-way (push or pull), or two-way.

## Incoming and Outgoing Replication Queries

A peer's **Incoming** Replication Queries specify which data it wants from other peers.

Its **Outgoing** Replication Queries control which data it will give to other peers.

Both of these are lists of Query objects.  Adding more clauses inside a Query object narrows down the results (logical AND).  Adding more Query objects to the list broadens the results (logical OR).

```
// download /wiki/* and /about/* documents
// plus everything by me
syncer.incomingReplicationQueries = [
    {prefix: '/wiki/'},
    {prefix: '/about/'},
    {author: '@suzy.xxxxx'},
]

// only upload my own documents after a certain timestamp
syncer.outgoingReplicationQueries = [
    {
        author: '@suzy.xxxxx'
        timestampAfter: 1234500000000,
    },
]
```

## Transactions, data integrity

There are no transactions or batch writes.  The atomic unit is the document.  If you update 2 documents at the same time, it's possible that peers will end up with just one of the updates -- because of an interrupted sync, or because one was filtered out by a replication query.

## Conflict resolution

Earthstar does not have fancy conflict resolution.

Each document has a history of old versions.  Earthstar keeps one version from each author.  Older versions are forgotten.

When fetching a path, the latest version is returned (by author-asserted timestamp).  You can also get all versions if you want to do manual conflict resolution.

**THIS IMAGE IS OUT OF DATE** but it shows how conflict resolution works.  TODO: update this

![](earthstar-data-model.png)