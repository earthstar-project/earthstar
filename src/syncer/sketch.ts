import { Peer } from "../peer/peer.ts";

const myPeer = new Peer();

// Do we add a syncer to a peer?
myPeer.addSyncer();
myPeer.syncWith("http://something.pub");
myPeer.syncWith(anotherPeer);
// the above is difficult because the peer won't have any syncing methods built in by default
// it worked in react-earthstar because there was only one kind of syncing (HTTP)

// Or a peer to a syncer...?
// Because we want to be able to do things like add a new connection from outside
// 	to a local peer
//  or another pub
const syncer = new SyncerHttp(peer);
syncer.addServer("https://my.pub");

const syncerLocal = new SyncerLocal(peer);
syncerLocal.addPeer(otherPeer);
syncer.stop();

// would the constructor always look the same? Just passing the peer...? Then it could be passed to the peer... but

myPeer.addSyncer((peer) => {
    return new SyncerLocal(peer);
});

myPeer.syncers["local"];

// but this adds so much complexity... we have to manage syncer ourselves and provide an API for accessing them. Also we'd have to make choices about whether a peer could have many of the same syncers... it's just too inflexible

// thinking about other things we want to do.
// pause a transport
// turn off syncing for a single share
