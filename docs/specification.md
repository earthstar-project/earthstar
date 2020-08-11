# Earthstar specification

Format: `es.4`

Document version: 2020-08-09.1

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Contents**

- [Libraries needed to implement Earthstar](#libraries-needed-to-implement-earthstar)
  - [ed25519 signatures](#ed25519-signatures)
  - [base32 encoding](#base32-encoding)
  - [base64 encoding](#base64-encoding)
  - [Indexed storage](#indexed-storage)
- [Vocabulary and concepts](#vocabulary-and-concepts)
- [Data model](#data-model)
- [Identities, Authors, Workspaces](#identities-authors-workspaces)
  - [Character set definitions](#character-set-definitions)
  - [Workspace addresses](#workspace-addresses)
    - [A future feature: invite-only workspaces](#a-future-feature-invite-only-workspaces)
  - [Author addresses](#author-addresses)
  - [FAQ: Author Shortnames](#faq-author-shortnames)
  - [Author profiles](#author-profiles)
- [Paths and write permissions](#paths-and-write-permissions)
  - [Paths](#paths)
  - [Path punctuation that has special meaning](#path-punctuation-that-has-special-meaning)
  - [Write permissions](#write-permissions)
  - [Path and filename conventions](#path-and-filename-conventions)
- [Documents and their fields](#documents-and-their-fields)
  - [Author](#author)
  - [Format](#format)
    - [Validator responsibilities](#validator-responsibilities)
  - [Content](#content)
  - [Content Hash](#content-hash)
  - [Path](#path)
  - [Timestamps](#timestamps)
  - [Ephemeral documents](#ephemeral-documents)
  - [Signature](#signature)
  - [Workspace](#workspace)
- [Document serialization](#document-serialization)
  - [Serialization for hashing and signing](#serialization-for-hashing-and-signing)
  - [Serialization for network](#serialization-for-network)
  - [Serialization for storage](#serialization-for-storage)
- [Querying](#querying)
- [Syncing](#syncing)
  - [Workspace secrecy](#workspace-secrecy)
  - [Sync queries](#sync-queries)
  - [Resolving conflicts](#resolving-conflicts)
  - [Networking](#networking)
- [Future directions](#future-directions)
  - [Invite-only workspaces](#invite-only-workspaces)
  - [Encryption](#encryption)
  - [Immutable documents](#immutable-documents)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

> The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL
> NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED",  "MAY", and
> "OPTIONAL" in this document are to be interpreted as described in
> [RFC 2119](https://tools.ietf.org/html/rfc2119).
> "WILL" means the same as "SHALL".

# Libraries needed to implement Earthstar

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

**Author** -- A person who writes documents to a workspace.  Authors are identified by an ed25519 public key in a format called an **author address**.  It's safe for an author to use the same identity from multiple devices simultaneously.

**Workspace** -- A collection of documents.  Workspaces are identified by a **workspace address**.  Workspaces are separate, unrelated worlds of data.  Each document exists within exactly one workspace.

**Format, Validator** -- The Earthstar document specification is versioned.  Each version of the specification is called a document **format**, and the code that handles that format is called a **Validator**.

**Peer** -- A device which holds Earthstar data and wishes to sync with other peers.  Peers may be individual users' devices and/or pub servers.  A peer may hold data from multiple workspaces.

**Pub server** -- (short for "public server") -- A peer whose purpose is to provide uptime and connectivity for many users.  Usually these are cloud servers with publically routable IP addresses.

# Data model

A peer MAY hold data from many workspaces.  Each workspace's data is treated independently.  Each document within a workspace is also independent; they don't form a chain or feed; they don't have Merkle backlinks.

A workspace's data is a collection of documents by various authors.  A peer MAY hold some or all of the documents from a workspace, in any combination.  Apps MUST assume that any combination of docs may be missing.

Each document in a workspace exists at a path.  For each path, Earthstar keeps the newest document from each author who has ever written to that path.

In this example, the `/wiki/shared/Flowers` path contains 3 documents, because 3 different authors have written there.  They may have written there hundreds of times, but we only keep the newest document from each author, in that path.

```
// Simplified example of data stored in a workspace

Workspace: "+gardening.friends"
  Path: "/wiki/shared/Flowers"
    Documents in this path:
      { author: @suzy.b..., timestamp: 1500094, content: 'pretty' }
      { author: @matt.b..., timestamp: 1500073, content: 'nice petals' }
      { author: @fern.b..., timestamp: 1500012, content: 'smell good' }
  Path: "/wiki/shared/Bugs"
    Documents in this path:
      { author: @suzy.b..., timestamp: 1503333, content: 'wiggly' }
```

"Newest" is determined by comparing the `timestamp` field in the documents.  See the next section for details about trusting timestamps.

When looking up a path to retrieve a document, the newest document is returned by default.  Apps can also query for the full set of document versions at a path; the older ones are called **history documents**.

## Ingesting documents

When a new document arrives and an existing one is already there (from the same author and same path), the new document overwrites the old one.  Earthstar libraries MUST actually delete the older, overwritten document.  The author's intent is to remove the old data.

The process of validating and potentially saving an incoming document is called **ingesting**, and it MUST happen to newly obtained documents, whether they come from other peers or are made as local writes.  Earthstar libraries MUST use this ingestion process:

```ts
// pseudocode

Ingest(newDoc):
    // check validity -- bad data types, bad signature,
    // expired ephemeral doc, wrong format string, etc...
    if !isValid(newDoc):
        return "rejected an invalid doc"

    // check if it's obsolete
    let existingDoc = query({author: newDoc.author, path: newDoc.path});
    if existingDoc exists && existingDoc.timestamp >= newDoc.timestamp;
        return "ignored an obsolete doc"

    // overwrite
    if existingDoc exists:
        remove(existingDoc)
    save(newDoc)
    return "accepted a doc"
```

## Trusting timestamps

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

## Workspace addresses

```
WORKSPACE_ADDRESS = "+" NAME "." SUFFIX
NAME = ALPHA_LOWER ALPHA_LOWER_OR_DIGIT*(0 to 14 characters)
SUFFIX = ALPHA_LOWER ALPHA_LOWER_OR_DIGIT*(0 to 52 characters)
```

A workspace address starts with `+` and combines a **name** with a **suffix**.

The name:
* MUST be 1 to 15 characters long, inclusive.
* MUST only contain digits and lowercase ASCII letters
* MUST NOT start with a digit

The suffix:
* MUST be 1 to 53 characters long, inclusive.
* MUST only contain digits and lowercase ASCII letters
* MUST NOT start with a digit

A workspace address MUST have two parts separated by a single period.

No uppercase letters are allowed.

Valid examples:

```
+a.b
+gardening.friends
+gardening.j230d9qjd0q09of4j
+gardening.bnkksi5na3j7ifl5lmvxiyishmoybmu3khlvboxx6ighjv6crya5a
+bestbooks2019.o049fjafo09jaf
```

> **Why these rules?**
>
> These rules allow workspace addresses to be used as the location part of regular URLs, after removing the `+`.

Workspace suffixes may be used in a variety of ways:

* meaningful words similar to domain name TLDs
* random strings that make the workspace hard to guess
* public keys in base32 format, starting with `b`, to be used as the **workspace key** in future versions of Earthstar (see below).

Note that anyone can write to and read from a workspace if they know its full workspace address, so it's important to keep workspace addresses secret if you want to limit their audience.

### A future feature: invite-only workspaces

In the future, Earthstar will support **invite-only** workspaces which have an associated **workspace key** and **workspace secret**.  The key is used as the workspace suffix, and the secret is given out-of-band to authors who should be able to write.

Only authors who know the workspace key can write to an invite-only workspace.  They will sign their documents with the workspace secret (in a new field, `workspaceSignature`, in addition to the regular author signature).

This will limit who can write, but anyone knowing the workspace address can still read.  To limit readers, authors may choose to encrypt their document content using the workspace key so that anyone with the workspace secret can decrypt it.

## Author addresses

```
@suzy.bo5sotcncvkr7p4c3lnexxpb4hjqi5tcxcov5b4irbnnz2teoifua
```

An author address starts with `@` and combines a **shortname** with a **public key**.

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

The content of the profile document is JSON, utf-8, in this schema:
```ts
{
    displayName? : string,  // human-readable name of this author
    bio? : string,  // a paragraph-length description of the person
    hue? : number,  // person's theme color.  an integer between 0 and 360.
}
```

TODO: length limits on name and bio?

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

* A path MUST begin with a `/`
* A path MUST NOT end with a `/`
* A path MUST NOT begin with `/@`
* Paths MAY contain upper case ascii letters, and are case sensitive.
* Paths MUST only contain the characters listed above.  To include other characters such as Unicode characters, apps SHOULD use [URL-style percent-encoding as defined in RFC3986](https://tools.ietf.org/html/rfc3986#section-2.1).  First encode the string as utf-8, then percent-encode the utf-8 bytes.
* TODO: maximum path length

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

> **Why these specific punctuation characters?**
>
> Earthstar paths are designed to work well in the path portion of a regular web URL.

> **Why can't a path start with `/@`?**
>
> When building web URLs out of Earthstar pieces, we may want to use formats like this:
>
> ```
> https://mypub.com/+gardening.friends/wiki/Dolphins
> https://mypub.com/+gardening.friends/@suzy.bo5sotcncvkr7...  (etc)
> ```
> 
> The restriction on `/@` allows us to tell paths and author addresses apart in this setting.  It also encourages app authors to put their data in a more organized top-level prefix such as `/wiki/` instead of putting each author at the root of the path.
>
> It would be nice to use a double slash `//` to begin paths and avoid confusion with authors:
>
> ```
> a template like this:
> https://mypub.com/:workspace/:path
>
> would make a URL like this:
> https://mypub.com/+gardening.friends//wiki/Dolphins
>                                      ^
> ```
>
> ...but some webservers treat this as user error and rewrite the double slash to a single slash.  So we have to carefully avoid the double slash when building URLs.

## Path punctuation that has special meaning

* `/` - separates path segments
* `~` - defines author write permissions
* `!` - used if and only if the document is ephemeral
* `%` - for percent-encoding other characters
* `*` - allowed, but it might be used in path queries, so consider avoiding it

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

An example document shown as JSON, though it can exist in many serialization formats:

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

All string fields MUST BE limited to printable ASCII characters except for `content`, which is utf-8.

If any fields are not formatted according to the rules described earlier, the document is invalid.

The `deleteAfter` field is OPTIONAL.  All other fields listed above are REQUIRED.  Additional fields are FORBIDDEN.

The order of fields is unspecified except for hashing and signing purposes (see section below).  For consistency, the recommended canonical order is alphabetical by field name.

## Author

The `author` field holds an author address, formatted according to the rules described earlier.

## Format

The format is a short string describing which version of the Earthstar specification to use when interpreting the document.

The current format version is `es.4`.  ("es" is short for Earthstar.)

If the specification is changed in a way that breaks forwards or backwards compatability, the format version MUST be incremented.  The version number SHOULD be a single integer, not a semver.

Other format families may someday exist, such as a hypothetical `ssb.1` which would embed Scuttlebutt messages in Earthstar documents, with special rules for validating the original Scuttlebutt signatures.

### Validator responsibilities

Earthstar libraries SHOULD separate out code related to each format version, so that they can handle old and new documents side-by-side.  Code for handling a format version is called a **Validator**.  Validators are responsible for:

* Hashing documents
* Signing new documents
* Checking document validity when ingesting documents from an external source
  * timestamp validity
  * formatting of string fields such as author addresses and paths
  * author write permissions to a path
  * signature validity
  * content matches contentHash
  * etc

Therefore each different format can have different ways of hashing, signing, and validating documents.

TODO: define basic rules that documents of all formats must follow

## Content

The `content` field contains arbitrary utf-8 encoded data.  To store binary data, apps SHOULD encode it as base64.

Apps SHOULD the path's file extension to guess if a document contains textual data or base64-encoded binary data.

TODO: add an encoding field to the document to make this less ambiguous?

> **Why no native support for binary data?**
>
> Common encodings such as JSON, and protocols built on them such as GraphQL, have to way to represent binary data.

`content` may be an empty string.  The recommended way to remove data from Earthstar is to overwrite the document with a new one, with `content = ""`.

In future versions the `content` will be allowed to be `null`, meaning we don't know what it is.  This allows handling documents without their actual content -- "sparse mode".  This is not allowed in the current version.

## Content Hash

The `contentHash` is the `sha256` hash of the `content` data.  The hash digest is then encoded from binary to base32 following the usual Earthstar format, with a leading `b`.

Note that hash digests are usually encoded in hex format, but we use base32 instead to be consistent with the rest of Earthstar's encodings.

Wrong: `binary hash digest --> hex encoded string --> base32 encoded string`

Correct: `binary hash digest --> base32 encoded string`

Also be careful not to accidentally change the content string to a different encoding (such as utf-16) before hashing it.

> **Why we record the content hash**
>
> In future versions we will allow the `content` field to be `null`, so we can handle document metadata without the full size of the content -- "sparse mode".  Document signatures are based on the `contentHash`, not the `content` itself.  This allows us to verify signatures on sparse-mode documents.

## Path

The `path` field contains a string following the path formatting rules described earlier.

The document is invalid if the author does not have permission to write to the path, following the rules described earlier in "Write permissions".

The path MUST contain at least one `!` character IF AND ONLY IF the document is ephemeral (has the optional `deleteAfter` field).

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

The document path MUST contain at least one `!` character IF AND ONLY IF the document is ephemeral.

> **Why ephemeral documents need a `!` in their path**
>
> Regular and ephemeral documents with the same path could interact in surprising ways.  To avoid this, we enforce that they can never collide on the same path.
>
> (An ephemeral document could propagate halfway across a network of peers, overwriting a regular document with the same path, and then expire and get deleted everywhere.  Then the regular document would regrow to fill the empty space.
>
> But if the ephemeral document traveled across the entire network and exterminated the regular document, and THEN expired, there would be nothing left.
>
> Which of these cases occurred would depend on how long the document took to spread, which could be very fast or could take months if there was a peer that was usually offline.  We'd like to avoid this unpredictability.)

## Signature

The ed25519 signature by the author encoded in base32 with a leading `b`.

## Workspace

The `workspace` field holds a workspace address, formatted according to the rules described earlier.

# Document serialization

There are 3 scenarios when we need to serialize a document to a string of bytes:

* Hashing and signing
* Network transmission
* Storage

They have different needs and we use different formats for each.

## Serialization for hashing and signing

When an author signs a document, they're actually signing a hash of the document.  We need a deterministic, standardized, and simple way to serialize a document to a sequence of bytes.  This is a **one-way** conversion -- we never need to deserialize this format.

Earthstar libraries MUST use this exact process.

To hash a document:

```
Sort the document fields in lexicographic order by field name.
Skip these fields: "content", "signature".
For each remaining field in the document:
    If the field value is an integer, convert it to a string.
    Concatenate (the field name, "\t", the field value, "\n").
Concatenate all of the above.
Compute the sha256 hash.
Encode the binary hash digest in base32 in Earthstar format, with leading "b".
```

To sign a document:

```
Compute the document hash.
Using the document author's keypair (public and private key),
    sign the document hash.
Encode the binary signature into base32 in Earthstar format, with leading "b".
Set document.signature to the base32 string.
```

Preconditions that make this work:
* Documents can only hold integers and strings, no floats or nested objects that could increase complexity or be nondeterministic
* No document field name or field content can contain `\t` or `\n`, except `content`, which is not directly used (we use `contentHash instead`)

The reference implementation is in `hashDocument()` in `src/validators/es4.ts`.  Here's a summary:

```ts
// Psuedocode

let serializeDocumentForHashing = (doc: Document): string => {
    // Fields in lexicographic order.
    // Convert numbers to strings.
    // Omit optional properties if they're missing.
    // Use the contentHash instead of the content.
    // Omit the signature.
    return (
        `author\t${doc.author}\n` +
        `contentHash\t${doc.contentHash}\n` +
        (doc.deleteAfter === undefined ? '' : `deleteAfter\t${doc.deleteAfter}\n`) +
        `format\t${doc.format}\n` +
        `path\t${doc.path}\n` +
        `timestamp\t${doc.timestamp}\n` +
        `workspace\t${doc.workspace}\n`
        // Note the \n is on on the last item too
    );
}

let hashDocument = (doc: Document): string =>
    bufferToBase32(
        sha256AsBuffer(
            serializeDocumentForHashing(doc)
        )
    );

let signDocument = (keypair: authorKeypair, doc: Document): Document => {
    return {
        ...doc,
        signature: sign(keypair, hashDocument(doc))
    };
}
```

Example

```
INPUT (shown as JSON, but is actually in memory before serialization)
{
  "format": "es.4",
  "workspace": "+gardening.friends",
  "path": "/wiki/shared/Flowers",
  "contentHash": "bt3u7gxpvbrsztsm4ndq3ffwlrtnwgtrctlq4352onab2oys56vhq",
  "content": "Flowers are pretty",
  "author": "@suzy.bjzee56v2hd6mv5r5ar3xqg3x3oyugf7fejpxnvgquxcubov4rntq",
  "timestamp": 1597026338596000,
  "signature": ""  // is empty before signing has occurred
}

SERIALIZED FOR HASHING:
author\t@suzy.bjzee56v2hd6mv5r5ar3xqg3x3oyugf7fejpxnvgquxcubov4rntq\n
contentHash\tbt3u7gxpvbrsztsm4ndq3ffwlrtnwgtrctlq4352onab2oys56vhq\n
format\tes.4\n
path\t/wiki/shared/Flowers\n
timestamp\t1597026338596000\n
workspace\t+gardening.friends\n

HASHED AND ENCODED AS BASE32:
b6nyw25gum45gcxbhez3ykx3jopkhlfjj2rnmfb7rt6yhkszvidsa

AUTHOR KEYPAIR:
{
  "address": "@suzy.bjzee56v2hd6mv5r5ar3xqg3x3oyugf7fejpxnvgquxcubov4rntq",
  "secret": "b6jd7p43h7kk77zjhbrgoknsrzpwewqya35yh4t3hvbmqbatkbh2a"
}

SIGNATURE;
bjljalsg2mulkut56anrteaejvrrtnjlrwfvswiqsi2psero22qqw7am34z3u3xcw7nx6mha42isfuzae5xda3armky5clrqrewrhgca
```

> **Why use `contentHash` instead of `content` for hashing documents?
>
> This lets us drop the actual content (to save space) but still verify the document signature.  This will be useful in the future for "sparse mode".

## Serialization for network

This is a **two-way** conversion between memory and bytes.

Earthstar doesn't have strong opinions about networking.  This format does not need to be standardized, but it's good to choose widely used familiar tools.  JSON makes a good default choice.

**Good choices**:

* Encodings
  * JSON
  * newline-delimited JSON for streaming lots of documents
  * CBOR
  * msgpack
* Protocols
  * GraphQL (relies on JSON)
  * REST
  * gRPC?
  * muxrpc (from SSB)

## Serialization for storage

This is a **two-way** conversion between memory and bytes.

It does not need to be standardized; each implementation can use its own format.

It needs to support efficient mutation and deletion of documents, and querying by various properties.

It would be nice if this was an archival format (corruption-resistant and widely known).

**Good choices:**

* SQLite
* Postgres
* IndexedDB
* leveldb (with extra indexes)
* a bunch of JSON files, one for each document (with extra indexes)

For exporting and importing data:
* one giant newline-delimited JSON file

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

Syncing is the process of trading documents between two peers to bring each other up to date.

Syncing can occur locally (within a process, between two Storage instances) as well as across a network.

Documents are locked into specific workspaces; therefore syncing can't transfer documents between workspaces, only between different peers that hold the same workspace.

## Networking

The network protocols used by peers to sync documents are not standardized yet.

## Workspace secrecy

Knowing a workspace address gives a user the power to read and write to that workspace, so they need to be kept secret.

It MUST be impossible to discover new workspaces through the syncing process.  Peers MUST keep their workspaces secret and only transmit data when they are sure the other peer also knows the address of the same workspace.

Here's an algorithm to exchange workspaces without discovering new ones:

* Peer1 and Peer2 send each other random numbers, and XOR them together into a shared nonce.
* Each peer shares sha256(workspaceAddress + nonce) for each of their workspaces

The hashes they have in common correspond to the workspaces they both have.

The hashes that are unique to one peer will reveal no information to the other peer.

They can now proceed to sync each of their common workspaces, one at a time.

## Sync queries

During a sync, apps SHOULD be able to specify which documents they're willing to share, and which they're interested in getting.

Apps do this by defining **Sync queries**.  An app SHOULD be able to define:

* An array of **incoming sync queries** -- what you want
* An array of **outgoing sync queries** -- what you will share

The queries in each array are additive: if a doument matches any query in the array, the document is chosen.

This contrasts with the behavior of query fields inside each query object, each of which narrows the results down further.

By taking advantage of these two techniques, both AND and OR type behaviour is possible.

Example:
```ts
// ask for all the About documents, and the recent Wiki documents
let incomingQueries = [
    {
        pathPrefix: '/about/',
        includeHistory: true,
    },
    {
        pathPrefix: '/wiki/',
        includeHistory: true,
        timestampAfter: 15028732938984
    },
];

// only share documents I wrote myself
let outgoingQueries = [
    {
        versionsByAuthor: '@suzy.bjzee56v2hd6mv5r5ar3xqg3x3oyugf7fejpxnvgquxcubov4rntq',
        includeHistory: true
    },
];
```

(Note: `timestampAfter` is shown for illustration purposes; that query field is not implemented yet)

## Resolving conflicts

See the Data Model section for details about conflict resolution.

# Future directions

## Invite-only workspaces

## Encryption

## Immutable documents
