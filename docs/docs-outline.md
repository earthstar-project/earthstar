### Outline for longer documentation
```
Earthstar
a toolkit for making p2p apps

alpha

community: chatrooms, etc
code of conduct
contributing guidelines

motivation
    local governance
    mutual aid / no profit motive / DIY

for users
    [diagram of users and pub servers]
    identities ("accounts") - what are they
    workspaces
    data and hosting are now 2 different things
    privacy properties of pubs and DHT
    who can read your stuff
    who can steal your password

for developers
    FAQ
    vocabulary table
    comparisons with SSB, couchdb, dat
    getting started example

    the way of earthstar
        a workspace is a map from (path, author) --> latest doc by timestamp
        workspaces are separate unrelated universes
            author identities can be reused across workspaces
        sync happens one workspace at a time
        sync can only happen if the workspace matches on both sides
        always delete old docs to respect author intent
        docs are validated one at a time in isolation
        expect gaps
        don't use sequence numbers, use timestamps
        don't use merkle backlinks, use version vectors
            authors will be using multiple devices with the same key,
            but version vectors need device ids too.
        it's ok to randomly drop docs (by age, by author, by key prefix, ...)
        never assume that having doc A means you also have doc B
        no batch writes
        finding the right balance between large docs and small docs
            large docs ensure data within the doc is all there and from the same version
            small docs make easier syncing with less likely conflicts

    core standards
        data model & merge properties
        message format (& hashing & signing)
        address formats (workspace and author)
        validators
    network standards
        HTTP REST endpoints
        RPC?
        sync over duplex stream
        query objects, for replication queries
        efficient replication
    app-level standards
        about layer
        wiki layer
        links in wiki code / markdown
    out of scope
        workspace discovery -- users should do this out of band
        pub discovery -- users should do this out of band
        IP address privacy -- users should use TOR or VPN
        finding p2p connections -- apps should use hyperswarm, libp2p, webrtc
        fancy merging -- apps can use version vectors to help with this
    library-specific details
        arrangement of classes and functions
        browserifying

    JS API reference

for contributors to this library
    BDFL
    licensing
    coding standards
    test coverage
    browserifying

future changes
    workspace sigil // will change
    doc.value will change from string to JSON or something similar
    docs will be explicitly marked when deleted, maybe using a value of `null`
    choosing an RPC style
    secret-handshake?
    async storage
```






