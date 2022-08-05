import * as Earthstar from "./mod.ts";
import { assert } from "https://deno.land/std@0.150.0/testing/asserts.ts";

logNarrator("This is a story about two friends.");

logRabbit("I'm Rabbit!");
logFrog("And I'm Frog.");

logNarrator(
  `Because they are animals living in the woods, they had intermittent internet connections, and a canny recognition of the limits of human systems.
  
Hence their interest in p2p systems such as Earthstar.
  
They started by generating keypairs for themselves:`,
);

const rabbitKeypair = await Earthstar.Crypto.generateAuthorKeypair("bunn");
const frogKeypair = await Earthstar.Crypto.generateAuthorKeypair("frog");

assert(!Earthstar.isErr(rabbitKeypair));
assert(!Earthstar.isErr(frogKeypair));

logRabbit(`My identity's address is ${rabbitKeypair.address}`);
logFrog(`And mine's ${frogKeypair.address}`);

logNarrator("And decided on a share address to keep between themselves...");

const shareAddress = Earthstar.generateShareAddress("wimbleywoods");

assert(!Earthstar.isErr(shareAddress));

logRabbit(`Pssst... our share address is ${shareAddress}`);
logFrog("Cool, got it.");
logRabbit(`See you later!`);

logNarrator(`... and went their separate ways.
  
At home, they each created their own 'Replica', their own personal copy of all the data kept in ${shareAddress}.`);

logRabbit(`Says here this thing needs a 'driver'...`);

const driverRabbit = new Earthstar.ReplicaDriverMemory(shareAddress);
const replicaRabbit = new Earthstar.Replica({ driver: driverRabbit });

logReplica(`Greetings, User! I am ${replicaRabbit.replicaId}!`);

logNarrator("Meanwhile...");

logFrog("I wonder if there are other kinds of driver?");

const driverFrog = new Earthstar.ReplicaDriverMemory(shareAddress);
const replicaFrog = new Earthstar.Replica({ driver: driverFrog });

logReplica(`Greetings, User! I am ${replicaFrog.replicaId}!`);

logFrog("Charmed.");

logNarrator(
  "Now that they had their own replicas, they could write data to their heart's content. Frog got home first.",
);

logFrog("Right. Let's break this thing in...");

const frogsFirstDoc = await replicaFrog.set(frogKeypair, {
  path: "/test",
  text:
    "I twisted the key. The 300 horsepower engine purred to life as I rested my webbed hand on the gearstick. Without hesitation I let the handbrake loose and roared into the distance. What awaited me over that horizon? Who can say.",
});

assert(!Earthstar.isErr(frogsFirstDoc));

logReplica("Document written!");
logFrog("It's beautiful...");
console.group();
console.log(frogsFirstDoc);
console.groupEnd();

logNarrator("And Rabbit returned home later after a leisurely stroll.");

logRabbit(
  `How does this thing work? Any data I write needs to be at a particular 'path'...`,
);

const rabbitsFirstDoc = await replicaRabbit.set(rabbitKeypair, {
  path: "/test",
  text: "testy test...",
});

assert(!Earthstar.isErr(rabbitsFirstDoc));

logReplica("Document written!");
logRabbit("Let's take a look...");
console.group();
console.log(rabbitsFirstDoc);
console.groupEnd();

logRabbit("How about something else?");

const rabbitsSecondDoc = await replicaRabbit.set(rabbitKeypair, {
  path: "/carrot_soup",
  text:
    "My wonderful recipe for carrot soup. Selecting the right carrots is of the utmost importance. Call your attention to the bushiness of their leaves...",
});

assert(!Earthstar.isErr(frogsFirstDoc));
logReplica("Document written!");
console.group();
console.log(rabbitsSecondDoc);
console.groupEnd();

logNarrator(
  "... and so on. The next morning they hurried to their favourite meeting spot to show their hard work to each other.",
);

logFrog("I got through my creative block last night! You have to see this...");
logRabbit(
  "I know you prefer flies, but do give this carrot soup recipe a try sometime.",
);

logNarrator(
  "They could 'sync' their replicas so that they'd have each other's data.",
);

logRabbit(
  "I read the manual. We both need to make something called a Peer to sync data.",
);
logFrog("One sec...");

const peerRabbit = new Earthstar.Peer();
const peerFrog = new Earthstar.Peer();

peerRabbit.addReplica(replicaRabbit);
peerFrog.addReplica(replicaFrog);

logRabbit("Here goes nothing...");

const syncer = peerRabbit.sync(peerFrog);

await syncer.isDone;

logReplica("Synced, baby!!!");

logFrog("... Why does it talk like that?");

logNarrator(
  "But then they looked inside their replicas and were somewhat surprised.",
);

logFrog("Oh, here's your ");

Deno.exit(0);

// =====================================

function logNarrator(text: string) {
  console.log(`
${text}
`);
}

function logRabbit(text: string) {
  console.log(`%c   🐰 ${text}`, "color: chocolate;");
}

function logFrog(text: string) {
  console.log(`%c   🐸 ${text}`, "color: darkgreen;");
}

function logReplica(text: string) {
  console.log(`%c   📂 ${text}`, "color: grey;");
}
