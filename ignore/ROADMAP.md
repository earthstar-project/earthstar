# Roadmap


## Done
* Signatures
* In-memory store
* SQLite store
* Tests
* Better README

## Todo

### Immediate tasks
* check if workspace matches existing database in constructor
* set default format & validator in constructor

### Demos
* Shopping list
* Wiki
* Social network

### General
* Figure out the classes
    * `DemoApp`
    * `Daemon` / `cli`
    * `Store`
    * Sync algorithm
    * Transport: HTTP, duplex
    * Peer finder & connection starter
* Figure out which social features belong in `Store` and which are higher level
    * Workspaces
    * Groups
    * Following & blocking
* Workspaces
    * Is this a `Store`-level thing?  Does it go in the key or is it a special field?
        * It's critical for replication scope and peer finding so let's make it a special field.  It's like a scuttleverse or a dat key.  You replicate one workspace at a time.  You may or may not reuse author keys across workspaces.
        * Or, how to do workspaces / groups at the app level:
            * Example: `{@workspace}/{@user}/blah`
            * Allow multiple pubkeys in a item key.  Use one for the workspace key.
            * Turn `signature` into a list of signatures, in the same order as the ones in the key.
            * Require **all** mentioned pubkeys to have a signature, not just one.
            * Or have required keys and optional keys.  You need to have all required keys and at least one optional key.  Add sigils for this:
                * `{+workspace}/{&user1}{&user2}/blah` - require workspace and at least one of user1/user2
                * or `{workspace}/{user1|user2}/blah` - require one key from each set of brackets
    * What is a workspace ID?
        * Anything (or hash(anything))
        * A pubkey
        * Hash of a manifest
        * How do we know if it's a pubkey and therefore requires a signature?
    * How do people get permission to join?
        * Knowing the workspace pubkey
        * Knowing the workspace private key
        * Added by any existing member (requires manifest)
        * Added by core members (requires manifest)
    * Workspace manifest
* Sync policies for store and Syncer
    * Who to connect to
    * Whose content to get
    * Whose content to share
    * Which keys to get / share
    * History mode: all / one per author / none
    * It's more flexible to make these all functions that are called on demand, but if we can just know them as lists it makes sync more efficient because we can enumerate them

### Store Spec
* Add {hash} to make immutable keys work
    * Disallow hashes in regular keys to avoid ovewriting them.
* `value` encoding for binary, json, tombstones, etc
* Tombstones: `null`, `tombstone:`, or a new field `isDeleted`?
* Revise pubkey encoding and sigils (base58check?)
* Revise allowed characters in keys
    * Check url-safety
    * Limit to ASCII to avoid unicode normalization problems?
* Encrypted messages & indexing of them
* Do we need to add any other types of messages besides KV items?
    * Workspace manifests?

### Store
* Add `author` field to query
* More tests to make sure sqlite queries are working right
* History mode: all / one per author / none
* Once we have tombstones, omit tombstones from keys()?
* A method to drop content
    * Forget history older than ___
    * Forget author
    * Forget keys
    * Provide a query, drop things that match or don't match?
* Consider overlay API

### Syncer
* Starting point
    * basic HTTPServer
    * basic HTTPClient
* JSON-RPC over HTTP and/or duplex streams
* Do you talk to a remote Syncer or a remote Store?  or both?
* Syncer -- HTTP-JSON-RPC-server --- HTTP-JSON-RPC-client -- Syncer
* Syncer -- Stream-JSON-RPC --- Stream-JSON-RPC -- Syncer

### Notes on reserved characters

```





Domain names / DNS
labels separated by "."
alphanumeric and "-" only, and must not start with "-"
case-insensitive
max 63 chars per label
use punycode to embed unicode or other characters "xn--"
browsers only allow some features (cookies?) if there is a "." in the domain


https://tools.ietf.org/html/draft-farrell-ni-00

URIs
https://en.wikipedia.org/wiki/Uniform_Resource_Identifier#Examples
https://tools.ietf.org/html/rfc3986#section-2.1
https://url.spec.whatwg.org/#urls

scheme:[//authority]path[?query][#fragment]
authority = [userinfo@]host[:port]
scheme://userinfo:password@host:port/path?querykey=value&key2=value2#fragment

hostname = not /?&:, probably not @.  generally allowed: []:.-_  and %-encoded
  example hosts: [::1]   127.0.0.1   localhost   www.example.com

userinfo = unreserved, sub-delims, percent-encoded, or ":" but don't use ":"
port = digits only
path = unreserved, sub-delims, pct-encoded, / is special, sometimes no :, . and .. have meaning

unreserved      -._~  09AZaz
reserved
    sub-delims  !'()*  $&+,;=
    gen-delims  :/?#[]@

allowed           0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz
allowed           '()-._~  and reserved somehow: !*
used by URLs      #$&+,/:;=?@
forbidden in URLs  "<>[\]^`{|}  and % except used for percent-encoding

appear to work in the path part of urls without %-encoding:
even though they fail allowedInUrlComponent:
                  '()-._~$&+,/:;=?@
no: #?

markdown uses     []()
html uses         <>"&

URNs:
urn:namespace:details
namespace        09AZaz and -    case insensitive, <= 30 chars
details          09AZaz %-encoded and ()+,-.:=@;$_!*'
reserved
    % for percent-encoding
    /?# reserved for paths, queries, fragments
forbidden:       &"<>\^`{|}~

Magnet URIs
https://en.wikipedia.org/wiki/Magnet_URI_scheme

magnet:?xt=urn:btih:xxxxxxxxxx
sha1
btih: "bittorrent info hash"

Unicode identifier and pattern syntax, and unicode hashtags
https://unicode.org/reports/tr31/

```

TODO: if doing conflict resolution by hand, do we need a `supercedes` field for backlinks to other old values that we're overriding?
