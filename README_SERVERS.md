# Earthstar Servers

An Earthstar server is an always-online peer which can synchronise with other
[Earthstar](https://earthstar-project.org) peers over the internet.

It's also just a server, so it can handle requests from browsers and serve back
responses, e.g. HTML pages made from data on your Earthstar shares.

An Earthstar server is configured with _extensions_ which give the server its
capabilities. For example: syncing over the web, reading a list of shares to
host from disk, or serving share attachments over HTTP.

## About shares and discoverability

Earthstar peers only sync shares they have in common, and they do this without
revealing to each other what those shares are. If a peer connects and wants to
sync their `+gardening` share with the server, the server will need to know
about that share's address ahead of time to do so.

Configuring the server's shares is done with extensions like
`ExtensionKnownShares`, which pulls a list of shares to host from a JSON file,
or `ExtensionServerSettings` which reads server configuration data from a share.

## About shares, hosting, and secrets

Earthstar servers are able to sync share data _without having to know the secret
for that share_. All they need to be able to do is validate data with the
share's public address.

What this means is that you can rehost shares you like and support the Earthstar
ecosystem without having to convince people to hand over their secrets (you just
need to convince them to share their addresses).

It also means that there's no way to steal share secrets from a server — as
those credentials were never there to begin with.

## Installation

For Deno:

```ts
import { Server } from "https://deno.land/x/earthstar@v10.0.0/mod.ts";
```

> Earthstar's syncing does not work with version of Deno between 1.27.0 - 1.28.1
> (inclusive) due to a regression in these versions' WebSocket implementation.

For NPM:

```
npm install @earthstar-project/server
```

```ts
import { Server } from "earthstar/node";
```

## Setting up a server

Here's how to run a basic server which creates replicas from a list of shares on
disk, and is able to sync over the web.

```ts
import {
  ExtensionKnownShares,
  ExtensionSyncWeb,
  Server,
} from "https://deno.land/x/earthstar@v10.0.0/mod.ts";

const server = new Server([
  new ExtensionKnownShares({
    // known_shares.json contains a JSON array of public share addresses.
    knownSharesPath: "./known_shares.json",
    // Persist share data to disk with ReplicaDriverFs
    onCreateReplica: (shareAddress) => {
      return new Earthstar.Replica({
        driver: new ReplicaDriverFs(shareAddress, "./share_data"),
      });
    },
  }),
  new ExtensionSyncWeb(),
]);
```

This looks a little bit different on Node, due to Node's server APIs have a very
different shape:

```ts
import {
  ExtensionKnownShares,
  ExtensionSyncWeb,
  Replica,
  ReplicaDriverFs,
  Server,
} from "earthstar";
import { createServer } from "http";

const nodeServer = createServer();

const server = new Server([
  new ExtensionKnownShares({
    // known_shares.json contains a JSON array of public share addresses.
    knownSharesPath: "./known_shares.json",
    // Persist share data to disk with ReplicaDriverFs
    onCreateReplica: (shareAddress) => {
      return new Earthstar.Replica({
        driver: new ReplicaDriverFs(shareAddress, "./share_data"),
      });
    },
  }),
  new ExtensionSyncWeb({ server: nodeServer }),
], { server: nodeServer });
```

The Node version of the `Server` API may not be able to support extensions which
use streaming responses, due to Node servers not using the same standard Fetch
API types which server extensions make use of.

## Extensions

The order in which you specify extensions matters, as some extensions may do
something which another extension depends upon, e.g. `ExtensionKnownShares` sets
up replicas which `ExtensionServeContent` will serve content from.

Equally, requests will fall through extensions, returning on the first match. So
sync extensions like `ExtensionSyncHttp` should come before
`ExtensionServeContent`, so that requests to sync aren't swallowed.

### `ExtensionKnownShares`

This extension configures which shares a server knows about and can sync.
Earthstar peers can only sync shares _they both know about beforehand_,
protecting your server from syncing data with strangers. The known share list is
pulled from a JSON file on disk, and you can specify how the extension should
create corresponding replicas for the shares.

### `ExtensionSyncWeb`

Makes it possible for Earthstar peers to sync with your server over a HTTP
connection.

### `ExtensionServeContent`

This extension will translate requests to the server to documents of a share of
your choice, so a request for `https://my.server/posts/page.html` will make this
extension fetch `/posts/page.html` from a replica, and serve it back in the
response. It'll do the same with text, images, videos, music and more.

### `ExtensionServerSettings`

This extension reads server settings from a specified share, allowing those
settings to be modified externally by other peers. These settings are adjusted
dynamically so that changes are reflected as soon as changes to the share is
made.

## Developing your own extensions

Your extension needs to implement the interface `IServerExtension`, which has
two methods:

- `register`: This will be called once when the server is initialised. This is
  where your extension will get access to the server's `Peer` instance.
- `handler`: This is called whenever a request is made to the server, and can be
  optionally handled by your extension if it does something with server requests
  (e.g. syncing, serving web content). If it doesn't, you can return
  `Promise<null>`, which will pass the request on to the next extension.

You can use your extension's constructor as a place for configuring the
extension before it's registered.

Extensions can be very simple or complex. `ExtensionKnownShares` is less than 50
lines of code.

Here's a simple extension which would display a message showing the number of
shares when a user would make a request to `/share-count`:

```ts
class ShareCounterExtension implements IServerExtension {
  private greeting: string;
  private peer: Earthstar.Peer;

  constructor(greeting: string) {
    // Set the user's greeting to a private variable.
    this.greeting = greeting;
  }

  register(peer: Earthstar.Peer) {
    // Set the server's peer to a private variable.
    this.peer = peer;

    // We could also do other stuff here, like start a new process in the background.
  }

  request(req: Request) {
    const url = new URL(req.url);

    // Check if the request is for `/share-count`
    if (url.pathname === "/share-count") {
      const shareCount = this.peer.replicas.length;

      // Serve up the greeting along with the number of shares on the server.
      return new Response(
        `${this.greeting}. This server is serving ${shareCount} shares!`,
      );
    }

    // Or pass the request on to the next extension.
    return Promise.resolve<null>;
  }
}
```

## Deploying a server

### Deploying the server

You will want to deploy our server to a machine with a publicly reachable IP
address.

Below is an example Dockerfile which will run a server which reads shares to
host with a `known_share.json` and persists share data to a directory called
`data`:

```docker
FROM denoland/deno:1.29.1

EXPOSE 8080
EXPOSE 443

WORKDIR /app

RUN mkdir /app/data/
	
VOLUME [ "/app/data" ]

COPY server.ts ./server.ts
COPY known_shares.json ./known_shares.json

USER deno

RUN deno cache --no-check=remote server.ts
CMD ["run", "--allow-all", "--no-check", "server.ts"]
```

And example contents of `server.ts`:

```ts
import {
  ExtensionKnownShares,
  ExtensionSyncWeb,
  Server,
} from "https://deno.land/x/earthstar@v10.0.0/mod.ts";

const server = new Server([
  new ExtensionKnownShares({
    // known_shares.json contains a JSON array of public share addresses.
    knownSharesPath: "./known_shares.json",
    // Persist share data to disk with ReplicaDriverFs
    onCreateReplica: (shareAddress) => {
      return new Earthstar.Replica({
        driver: new ReplicaDriverFs(shareAddress, "./share_data"),
      });
    },
  }),
  new ExtensionSync(),
], { port: 8000 });
```

### Templates

- [earthstar-server-glitch](https://github.com/earthstar-project/earthstar-server-glitch)
  A server template for Glitch (provides one-click option)
