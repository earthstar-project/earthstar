2020-07-16

NOTE This needs to be updated now that we've switched from base58 to base32.

### URL details

The workspace and author address formats are designed to work well in [URLs](https://tools.ietf.org/html/rfc3986) with two caveats:
* Sometimes the sigils need to be removed (`+` from workspace, `@` from author)
* base58 is case sensitive, but URL locations are supposed to be lowercase (at least for HTTP)

These rules make them URL-safe:
* Paths are already required to use percent-encoding for weird characters, so they work in URLs without change
* Workspaces and authors only contain alphanumeric chars, `.`, `+`, and `@`
* Workspace and authors have a dot in the middle so they're recognized as domains by browsers
* Workspace and author parts can't start with a number (including the base58 keys)
* Paths can't start with `/@`.  This avoids ambiguity between `WORKSPACE/PATH` and `WORKSPACE/AUTHOR`

So except for the base58 case issue, these are all guaranteed to be valid URLs.
```
earthstar://WORKSPACE_NO_PLUS
earthstar://WORKSPACE_NO_PLUS?QUERY
earthstar://WORKSPACE_NO_PLUS/PATH
earthstar://WORKSPACE_NO_PLUS/AUTHOR

earthstar://AUTHOR_NO_AT@WORKSPACE_NO_PLUS/PATH
earthstar://AUTHOR_NO_AT:AUTHOR_SECRET@WORKSPACE_NO_PLUS/PATH

http://mypub.com/WORKSPACE
http://mypub.com/WORKSPACE?QUERY
http://mypub.com/WORKSPACE/PATH
http://mypub.com/WORKSPACE/AUTHOR
```

examples, using `xxxxx` to stand in for long base58 strings

```
earthstar://gardening.xxxxx
earthstar://gardening.xxxxx?pathPrefix=/wiki/&limit=5
earthstar://gardening.xxxxx/wiki/Flowers
earthstar://gardening.xxxxx/@suzy.xxxxx

earthstar://suzy.xxxxx:xxsecretxx@gardening.xxxxx/wiki/Flowers

http://mypub.com/+gardening.xxxxx/wiki/Flowers
```

The `author:password@workspace` format puts the `@` in a confusing place compared with normal Earthstar sigils.  It could be OK just for doing writes in the fetch API if end users never see it in the browser UI?


### Pubs & swarms

These URLs don't contain pub information, except maybe one pub in the case of the http:// URLs.  But there could be multiple pubs and multiple swarms.

There will be 2 kinds of swarms:
* the usual main swarm: `swarm key = hash(workspaceAddress)`, like DAT
* secret swarms: `swarmKey = hash(workspaceAddress + swarmPassword)`

Swarm passwords are just secret strings you share with friends.  They let you connect only to trusted peers when you're in a very large or public workspace to protect your IP address privacy.