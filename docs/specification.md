# Earthstar specification

Format: `es.4`

Document version: 2020-08-09.1

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Contents**

- [Ingredients](#ingredients)
  - [ed25519 signatures](#ed25519-signatures)
  - [base32 encoding](#base32-encoding)
  - [base64 encoding](#base64-encoding)
  - [Indexed storage](#indexed-storage)
- [Vocabulary and concepts](#vocabulary-and-concepts)
- [Data model](#data-model)
- [Identities, Authors, Workspaces](#identities-authors-workspaces)
  - [Character set definitions](#character-set-definitions)
  - [Author addresses](#author-addresses)
  - [FAQ: Author Shortnames](#faq-author-shortnames)
  - [Author profiles](#author-profiles)
- [Paths and write permissions](#paths-and-write-permissions)
  - [Paths](#paths)
  - [Write permissions](#write-permissions)
  - [Path and filename conventions](#path-and-filename-conventions)
- [Documents and their fields](#documents-and-their-fields)
  - [Content](#content)
  - [Timestamps](#timestamps)
  - [Ephemeral documents](#ephemeral-documents)
  - [Document serialization](#document-serialization)
  - [Hashing and signing](#hashing-and-signing)
- [Querying](#querying)
- [Syncing](#syncing)
  - [Sync queries](#sync-queries)
  - [Resolving conflicts](#resolving-conflicts)
  - [Networking](#networking)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

> The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL
> NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED",  "MAY", and
> "OPTIONAL" in this document are to be interpreted as described in
> [RFC 2119](https://tools.ietf.org/html/rfc2119).
> "WILL" means the same as "SHALL".

# Ingredients

To make your own Earthstar library, you'll need:

## ed25519 signatures

This is the same cryptography format used by Secure Scuttlebutt and DAT/hyper.

## base32 encoding

Almost anywhere that binary data needs to be encoded in Earthstar, it's done with base32: public and private keys, signatures, hashes.  The exception is binary document content which is base64 (see next section).

We use [RFC4648](https://tools.ietf.org/html/rfc4648#section-6) with lowercase letters and no padding.  The character set is `abcdefghijklmnopqrstuvwxyz234567`.

Our encodings are always prefixed with an extra `b` character, following the [multibase](https://github.com/multiformats/multibase) standard.  The `b` format is the only format supported in Earthstar.  Libraries MUST enforce that encoded strings start with `b`, and MUST NOT allow any other encoding formats.

Libraries MUST be strict when encoding and decoding -- only allow lowercase characters; don't allow a `1` to be treated as an `i`.

> Why?
>
> * We want to use encoded data in URL locations, which can't contain upper-case characters, so base64 and base58 won't work.
> * base32 is shorter than base16 (hex).
> * The choice of a specific base32 variant was arbitrary and was influenced by the ones available in the multibase standard, which is widely implemented.
> * The leading `b` character serves two purposes: it defines which base32 format we're using, and it prevents encoded strings from starting with a digit.  This makes it possible to use encoded strings as standards-complient URL locations, as in `earthstar://gardening.bajfoqa3joia3jao2df`.

## base64 encoding

Document contents may only contain utf-8 strings, not arbitrary binary bytes.  Applications wishing to store binary data SHOULD encode it as base64.

The recommended format is [RFC4648](https://tools.ietf.org/html/rfc4648#section-4) base64, regular (not-URLsafe), with padding.  This is the same format used by `atob()` and `btoa()` in Javascript.

## Indexed storage

Earthstar messages are typically queried in a variety of ways.  This is easiest to implement using a database like SQLite, but if you manage your own indexes you can also use a key-value database like leveldb.

# Vocabulary and concepts

**Library, Earthstar library** -- In this context, an implementation of Earthstar itself.

**App** -- Software which uses Earthstar to store data.

**Document** -- The unit of data storage in Earthstar, similar to a document in a NoSQL database.  A document has metadata fields (author, timestamp, etc) and a **content** field.

**Path** -- Similar to a key in leveldb or a path in a filesystem, each document is stored at a specific path.

**Author** -- A person who writes documents to a workspace.  Authors are identified by an ed25519 public key in a format called an **author address**.

**Workspace** -- A collection of documents.  Workspaces are identified by a **workspace address**.  Workspaces are separate, unrelated worlds of data.  Each document exists within exactly one workspace.

**Format, Validator** -- The Earthstar document specification is versioned.  Each version of the specification is called a document **format**, and the code that handles that format is called a **Validator**.

**Peer** -- A device which holds Earthstar data and wishes to sync with other peers.  Peers may be individual users' devices and/or pub servers.  A peer may hold data from multiple workspaces.

**Pub server** -- (short for "public server") -- A peer whose purpose is to provide uptime and connectivity for many users.  Usually these are cloud servers with publically routable IP addresses.

# Data model

TODO

# Identities, Authors, Workspaces

## Character set definitions

```
ALPHA_LOWER = "abcdefghijklmnopqrstuvwxyz"
ALPHA_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
DIGIT = "0123456789"

B32CHAR = ALPHA_LOWER + "234567"
ALPHA_LOWER_OR_DIGIT = ALPHA_LOWER + DIGIT

PRINTABLE_ASCII = characters " " to "~", inclusive
                = decimal character code 32 to 126 inclusive
                = hex character code 0x20 to 0x7E inclusive
```

## Author addresses

```
@suzy.bo5sotcncvkr7p4c3lnexxpb4hjqi5tcxcov5b4irbnnz2teoifua
```

An author address combines a **shortname** with a **public key**.

**Shortnames** are chosen by users when creating an author identity.  They cannot be changed later.  They are exactly 4 lowercase ASCII letters or digits, and cannot start with a digit.

**Public keys** are 32-byte ed25519 public keys (just the integer), encoded as base32 with an extra leading "b".  This results in 52 characters of base32 plus the "b", for a total of 53 characters.

**Private keys** (called "secrets") are also 32 bytes of binary data (just the secret integer), encoded as base32 in the same way.

```
AUTHOR_ADDRESS = "@" SHORTNAME "." B32_PUBKEY
SHORTNAME = ALPHA_LOWER*1 ALPHA_LOWER_OR_DIGIT*3
B32_PUBKEY = "b" B32CHAR*52

AUTHOR_SECRET = "b" B32CHAR*52
```

Examples
```
address: @suzy.bo5sotcncvkr7p4c3lnexxpb4hjqi5tcxcov5b4irbnnz2teoifua
secret: becvcwa5dp6kbmjvjs26pe76xxbgjn3yw4cqzl42jqjujob7mk4xq 

address: @js80.bnkivt7pdzydgjagu4ooltwmhyoolgidv6iqrnlh5dc7duiuywbfq
secret: b4p3qioleiepi5a6iaalf6pm3qhgapkftxnxcszjwa352qr6gempa
```

Apps MUST treat authors as separate and distinct when their addresses differ, even if only the shortname is different and the pubkeys are the same.

Note that authors also have **display names** stored in their **profile document**.  See the next section.

## FAQ: Author Shortnames

> **Why shortnames?**
>
> Impersonation is a difficult problem in distributed social networks where account identifiers [can't be both unique and memorable](https://en.wikipedia.org/wiki/Zooko%27s_triangle).  Users have to vigilantly check for imposters.  Typically apps will treat following relationships as trust signals, displaying the accounts of people you follow in a different way to help you avoid imposters.
>
> Shortnames make user identifiers "somewhat memorable" to defend against impersonation.
>
> For example: In Scuttlebutt, users are identified by a bare public key and their display names are mutable.
>
> A user could create an account with a display name of "Cat Pictures" and get many followers.  They could then change the display name to match another user that they wish to impersonate.  Anyone who previously followed "Cat Pictures" is still following the account under the new name, causing the account to appear trustworthy in the app's UI.  Users decided to trust the account in one context (to provide cat pictures) but after trust was granted, the account changed context (to impersonate a friend).
>
> For example, let's say an app shows "✅" when you're following an account.  "✅ Cat Pictures @3hj29dhj..." renames itself to "✅ Samantha @3hj29dhj...", which is hard to tell apart from your actual friend "✅ Samantha @9c2j392hx...".
>
> Adding an immutable shortname to the author address makes this attack more difficult.  Users can now notice when display name is different than expected.
>
> For example "✅ Cat Pictures @cats.3hj29dhj..." renames itself to "✅ Samantha @cats.3hj29dhj...", which is easier to tell apart from your actual friend "✅ Samantha @samm.9c2j392hx...".
>
> Of course the attacker could choose to start off as "✅ Cat Pictures @samm.3hj29dhj...".  Users are expected to notice this as a suspicious situation when following an account.

> **Why are shortnames 4 characters?**
>
> Shortnames need to be long enough that they can express a clear relationship to the real identity of the account.
>
> They need to be short enough for users to intuitively understand that they are non-unique.

> **Why limit shortnames to ASCII?**
>
> Users would be better served if they could use their native language in shortnames, but this creates potential vulnerabilities from Unicode normalization.
>
> This usability shortfall is limited because shortnames don't need to be very expressive; users can use Unicode in the display name in their profile.

> **What if users want to change their shortnames?**
>
> Users can change their display names freely but their shortnames are fixed.  Modifying the shortname effectively creates a new identity and the user's followers will not automatically follow the new identity.
>
> Humane software must allows users to change their names.  (See [Falsehoods programmers believe about names](https://www.kalzumeus.com/2010/06/17/falsehoods-programmers-believe-about-names/)).  Choosing and changing your own name is a basic human right.
>
> Software should also help users avoid impersonation attacks, a common harassment technique which can be quite destructive.  Earthstar attempts to find a reasonable trade-off between these competing needs in the difficult context of a distributed system with no central name authority.
>
> Users who anticipate name changes, or dislike the permanence of shortnames, can choose shortnames which are memorable but non-meaningful, like `zzzz` or `9999`.

> **Can users create two identities with the same pubkey but different shortnames?**
>
> Yes.  They are considered two distinct identities, although you can infer that they belong to the same person.

## Author profiles

An author can have a **profiles** containing display names, biographic information, etc.  Profile data is stored in a document at a predefined path:

```
profilePath = "/about/~" + authorAddress + "/profile.json"

Example:
/about/~@suzy.bo5sotcncvkr7p4c3lnexxpb4hjqi5tcxcov5b4irbnnz2teoifua/profile.json
```

Display names stored in profile information can be changed frequently and can contain Unicode.

The content of the profile document is JSON, in this schema:
```ts
{
    displayName? : string,  // human-readable name of this author
    bio? : string,  // a paragraph-length description of the person
    hue? : number,  // person's theme color.  an integer between 0 and 360.
}
```

TODO: length limits?

# Paths and write permissions

## Paths

Similar to a key in leveldb or a path in a filesystem, each document is stored at a specific path.

Rules:

```
PATH_PUNCTUATION = "/'()-._~!*$&+,:=@%"  // double quote is not included
PATH_CHARACTER = ALPHA_LOWER + ALPHA_UPPER + DIGIT + PATH_PUNCTUATION

PATH_SEGMENT = "/" PATH_CHARACTER+
PATH = PATH_SEGMENT+
```

* A path must begin with a `/`
* A path must not end with a `/`
* A path must not begin with `/@`
* Paths may contain upper case ascii letters, and are case sensitive.
* Paths may only contain the characters listed above.  To include other characters such as Unicode characters, apps SHOULD use [URL-style percent-encoding as defined in RFC3986](https://tools.ietf.org/html/rfc3986#section-2.1).  First encode the string as utf-8, then percent-encode the utf-8 bytes.
* TODO: maximum length

Example paths:
```
Valid:
    /todos/123.json
    /wiki/shared/Dolphins.md
    /about/~@suzy.bo5sotcncvkr7p4c3lnexxpb4hjqi5tcxcov5b4irbnnz2teoifua/profile.json

Invalid: missing leading slash
    todos/123.json

Invalid: starts with "/@"
    /@suzy.bo5sotcncvkr7p4c3lnexxpb4hjqi5tcxcov5b4irbnnz2teoifua/profile.json

```

## Write permissions

Paths can encode information about which authors are allowed to write to them.  Documents that break these rules are invalid and will be ignored.

A path is **shared** if it contains no `~` characters.  Any author can write a document to a shared path.

A path is **owned** if it contains at least one `~`.  An author name immediately following a `~` is allowed to write to this path.  Multiple authors can be listed, each preceded by their own `~`.

Example shared paths:

```
anyone can write here:
/todos/123.json

anyone can write here because there's no "~"
/wall/@suzy.bo5sotcncvkr7p4c3lnexxpb4hjqi5tcxcov5b4irbnnz2teoifua
```

Example owned paths:

```
only suzy can write here:
/about/~@suzy.bo5sotcncvkr7p4c3lnexxpb4hjqi5tcxcov5b4irbnnz2teoifua/profile.json

suzy and matt can write here, and nobody else can:
/chat/~@suzy.bo5sotcncvkr7p4c3lnexxpb4hjqi5tcxcov5b4irbnnz2teoifua~@matt.bwnhvniwd3agqclyxl4lirbf3qpfrzq7lnkzvfelg4afexcodz27a/messages.json
```

This path can't be written by anyone.  It's **owned** because it contains a `~`, but an owner is not specified:

```
/example/~
```

The `tilde + author address` can occur anywhere in the path: beginning, middle or end.

## Path and filename conventions

Multiple apps can put data in the same workspace.  Here are guidelines to help them interoperate:

The first path segment SHOULD be a description of the data type or the application that will read/write it.  Examples: `/wiki/`, `/chess/`, `/chat/`, `/posts/`, `/earthstagram/`.

> Why?
>
> Peers can selectively sync only certain documents.  Starting a path with a descriptive name like `/wiki/` makes it easy to sync only wiki documents and ignore the rest.  It also lets apps easily ignore data from other apps.

The last path segment SHOULD have a file extension to help applications know how to interpret the data.

There is no way to explicitly signal that document content is binary (encoded as base64).  Applications will need to guess based on the file extension.

# Documents and their fields

Example document, shown as JSON:

```json
{
  "author": "@suzy.bjzee56v2hd6mv5r5ar3xqg3x3oyugf7fejpxnvgquxcubov4rntq",
  "content": "Flowers are pretty",
  "contentHash": "bt3u7gxpvbrsztsm4ndq3ffwlrtnwgtrctlq4352onab2oys56vhq",
  "format": "es.4",
  "path": "/wiki/shared/Flowers",
  "signature": "bjljalsg2mulkut56anrteaejvrrtnjlrwfvswiqsi2psero22qqw7am34z3u3xcw7nx6mha42isfuzae5xda3armky5clrqrewrhgca"
  "timestamp": 1597026338596000,
  "workspace": "+gardening.friends",
}
```

Document schema:

```ts
interface Doc {
    author: string, // an author address
    content: string, // an arbitary string of utf-8
    contentHash: string, // sha256(content) encoded as base32 with a leading 'b'
    deleteAfter?: number,  // when the document expires (optional)
    format: 'es.4', // the format version that this document adheres to.
    path: string, // a path
    signature: string, // ed25519 signature of encoded document, signed by author
    timestamp: number, // when the document was created
    workspace: string, // a workspace address
}
```

Note that all string fields are limited to printable ASCII characters except for `content`.

## Content

The `content` field contains arbitrary utf-8 encoded data.  To store binary data, apps SHOULD encode it as base64.

Apps SHOULD the path's file extension to guess if a document contains textual data or base64-encoded binary data.

TODO: add an encoding field to the document to make this less ambiguous?

> **Why no native support for binary data?**
>
> Common encodings such as JSON, and protocols built on them such as GraphQL, have to way to represent binary data.

## Timestamps

Timestamp are integer **microseconds** (millionths of a second) since the Unix epoch.

```ts
// javascript
let timestamp = Date.now() * 1000;
```

```python
# python
timestamp = int(time.time() * 1000 * 1000)
```

They MUST be within the following range (inclusive):

```ts
// 10^13
let MIN_TIMESTAMP = 10000000000000

// 2**53 - 1  (Number.MAX_SAFE_INTEGER)
let MAX_TIMESTAMP = 9007199254740991

timestampIsValid = MIN_TIMESTAMP <= timestamp && timestamp <= MAX_TIMESTAMP;
```

> **Why this specific range?**
>
> The min timestamp is chosen to reject timestamps that were accidentally computed in milliseconds or seconds.
>
> The max timestamp is the largest safe integer that Javascript can represent.
>
> The range of valid times is approximately 1970-04-26 to 2255-06-05.

Timestamps MUST NOT be from the future.  A limited tolerance is allowed to account for clock skew between devices.  The recommended value for the future tolerance is 10 minutes, but this can be adjusted depending on the clock accuracy of devices in a deployment scenario.

Timestamps from the future, beyond the tolerance threshold, are (temporarily) invalid and MUST NOT be accepted in a sync.  They can be accepted later, after they are no longer from the future.

## Ephemeral documents

Ephemeral documents have an expiration date, after which they MUST be proactively deleted by Earthstar libraries.

Libraries MUST check for and delete all expired documents at least once an hour (while they are running).  Deleted documents MUST be physically deleted, not just marked as ignored.

Libraries MUST filter out recently expired documents from queries and lookups.  Libraries MAY or MAY NOT physically delete them as they are queried; they may choose to wait until the next scheduled hourly deletion time.

The `deleteAfter` field holds the timestamp after which a document is to be deleted.  It is a timestamp with the same format and range as the regular `timestamp` field.

The `deleteAfter` field is optional.  If a document is not ephemeral, the field SHOULD BE omitted if possible; otherwise it may be set to `null` or `-1`.

Unlike the `timestamp` field, the `deleteAfter` field is expected to be in the future compared to the current wall-clock time.  Once the `deleteAfter` time is in the past, the document becomes invalid.

The `deleteAfter` time MUST BE strictly greater than the document's `timestamp`.

## Document serialization

TODO

## Hashing and signing

TODO

# Querying

Libraries SHOULD support a standard set of queries against a database of Earthstar messages.  The recommended set, in Typescript format, is:

```ts
// Query objects describe how to query a Storage instance for documents.
export interface QueryOpts {
    // An empty query object returns all documents.

    // Each of the following adds an additional filter,
    // narrowing down the results further.

    // Limit to documents from a certain workspace.
    // This may not be needed if you're querying a storage
    // instance that only holds one workspace.
    workspace?: string,

    path?: string,  // One specific path only.

    pathPrefix?: string,  // Paths starting with prefix.

    lowPath?: string,  // lowPath <= p 
    highPath?: string,  // p < highPath

    // Only return the first N documents.
    // This counts the total number of docs returned,
    // counting historical and most-recent versions.
    // There's no offset; use lowPath as a cursor instead.
    limit?: number,

    // Include old versions of this doc from different authors?
    includeHistory?: boolean, // default false

    // If including history, find paths where the author ever wrote, and return all history for those paths by anyone
    // If not including history, find paths where the author ever wrote, and return the latest doc (maybe not by the author)
    participatingAuthor?: AuthorAddress,

    //// If including history, find paths with the given last-author, and return all history for those paths
    //// If not including history, find paths with the given last-author, and return just the last doc
    //lastAuthor?: AuthorAddress,

    // If including history, it's any revision by this author (heads and non-heads)
    // If not including history, it's any revision by this author which is a head
    versionsByAuthor?: AuthorAddress,

    // timestamp before and after // TODO

    // sort order: TODO
    // For now the default sort is path ASC, then timestamp DESC (newest first within same path)

    // The time at which the query is considered to take place.
    // This is useful for testing ephemeral document expiration.
    // Normally this should be omitted.  It defaults to the current time.
    now?: number,
}
```

# Syncing

## Sync queries

## Resolving conflicts

## Networking
