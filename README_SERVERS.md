# Earthstar Servers

An Earthstar server is an always-online peer which can synchronise with other
[Earthstar](https://earthstar-project.org) peers over a HTTP.

It's also just a server, so it can handle requests from browsers and serve back
responses, e.g. HTML pages made from data on your Earthstar shares.

An Earthstar server is configured with _extensions_ which give the server its
capabilities. For example: syncing over a websocket connection, managing a
server's capabilities, or serving share payloads over HTTP.

## About shares and discoverability

Earthstar peers only sync shares they have in common, and they do this without
revealing to each other what those shares are. If a peer connects and wants to
sync their `+gardening` share with the server, the server will need a read
capability for that share ahead of time to do so.

In future there will be extensions to do this remotely. For now, you can
manually configure the `Peer` with its desired capabilities upon instantiation
of `Server`.
