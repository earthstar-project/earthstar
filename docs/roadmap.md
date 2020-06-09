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

unchanged by encodeURLComponent:
                  '()-._~  and reserved somehow: !*

unchanged by browsers, in paths:
                   $&+,/: =?@
not ok in paths:
                  #        ? 

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

URI types
```
ALNUM = azAZ09
WSNAME = ALNUM+ between 1 and 15 characters inclusive
B58KEY = azAZ09 * 43
UUID = azAZ09 * 20

// WS needs to look like a hostname.
// The name seperator needs to be one of "_" | "-" | "." but "." seems to work best.
// Total length not counting "//" needs to be <= 63 chars between periods

WS = "//" WSNAME "." B58KEY     // access-controlled group
WS = "//" WSNAME "." UUID    // secret group
     .........1.........2.........3.........4.........5.........6...
                .........1.........2.........3.........4...
   = //solarpunk.mVkCjHbAcjEBddaZwxFVSiQdVFuvXSiH3B5K5bH7Hcx
   = //solarpunk.mVkCjHbAcjEBddaZwxFV

// A way to include the workspace secret to use in invitations
WSSECRET = WS ("." B58SECRET)?
   = //solarpunk.mVkCjHbAcjEBddaZwxFV.secrethere


// AUTHOR has many options for its name separator like -_:.
// But let's use "." to match WS

AUTHOR = "@" ALNUM*4 "." B58KEY
   = @cinn.xjAHzdJHgMvJBqgD4iUNhmuwQbuMzPuDkntLi1sjjz


// FOLDERSEP could be any of "/" | ":" | "." but period is taken.
// let's use "/" to be like regular URL paths

FOLDERSEP = "/"
KEYCHAR = any of ALNUM  FOLDERSEP  '()-._~  !*  $&+,:=?@  %
KEY = "/" KEYCHAR*
    /wiki/shared/Solar%20Panels
    /about/~@cinn.xjAHzdJ/name


COMBO = WSSECRET "/" (AUTHOR | KEY)
    //solarpunk.mVkCjHbAcj/@cinn.xjAHzdJh
    //solarpunk.mVkCjHbAcj//key/wiki/shared/Farming
    //solarpunk.mVkCjHbAcj.secrethere//key/wiki/shared/Farming

PUBURL = ORIGIN COMBO
    http://mypub.com:8000//solarpunk.mVkCjHbAc
    http://mypub.com:8000//solarpunk.mVkCjHbAc//wiki/shared/Farming
    http://mypub.com:8000//solarpunk.mVkCjHbAcj/@cinn.xjAHzdJh
    http://mypub.com:8000//solarpunk.mVkCjHbAcj.secrethere/@cinn.xjAHzdJh

PUB_SYNC_API =
    http://mypub.com:8000//solarpunk.mVkCjHbAc/sync/v1/...

DHT = PROTOCOL "://" SWARMKEY COMBO
    hyperswarm://swarmkey//solarpunk.mVkCjHbAc
    libp2p://swarmkey//solarpunk.mVkCjHbAc.secrethere
```

wikilinks
```
wiki page links: these get "/wiki/shared/" put in front, or "/wiki/~@foo/"

    #with%20space   url-encode hashtags
    [[with space]]

    #sharedorpersonal   with no sigil where does it go?
    [[sharedorpersonal]]

    #+sharedpage   maybe a sigil for shared pages: "+" "&" ":"
    [[+sharedpage]]

    #~mypage     has just a tilde so it's my personal link.  should it have a slash too?  ~/foo
    [[~mypage]]

    #~@aaa/mypage    has a tilde so it's a personal link
    [[~@aaa/mypage]]

    #@aaa    just a user
    [[@aaa]]

regular markdown links to any earthstar key or author
    [a         key    link](/wiki/shared/page%20title)
    [a         author link](@cinn.fjaoeiJFOEF)
    [another     workspace](//gardening.aAbBcC)
    [a distant key    link](//gardening.aAbBcC//@cinn.fjaoeiJFOEF)
    [a distant author link](//gardening.aAbBcC//wiki/shared/Ladybug)

bare author
    @cinn_fjaoeiJFOEF

bare key
    /wiki/shared/page%20title

bare workspace
    //solarpunk.JoiaJDOajd
```

### TODO

if doing conflict resolution by hand, do we need a `supercedes` field for backlinks to other old values that we're overriding?
## Markdown parsing experiment

http://www.google.com

[xxx](http://www.google.com)

---

//google.com

[xxx](//google.com)

---

//solarpunk.aAaAa0011

[xxx](//solarpunk.aAaAa0011)

---

//solarpunk_aAaAa0011

[xxx](//solarpunk_aAaAa0011)

---

/abspath

[xxx](/abspath)

---

relpath/x

[xxx](relpath/x)

---

url()url

[xxx](url()url) ok

---

url url

[xxx](url url)

---

[xxx]

(yyy)

[[xxx]]

((yyy))

[/aaa]

(/aaa)

[aa aa]

(aa aa)
