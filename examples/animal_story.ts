// import * as Earthstar from "./mod.ts";
import * as Earthstar from "https://deno.land/x/earthstar@v10.0.1/mod.ts";
import { assert } from "https://deno.land/std@0.154.0/testing/asserts.ts";
import { delay } from 'https://deno.land/x/delay@v0.2.0/mod.ts';

// In which the story begins and we generate some keypairs.
// =======================================================================

logNarrator("This is a story about two friends.");

logRabbit("I'm Rabbit!");
logFrog("And I'm Frog.");

logNarrator(
  `Because they are animals living in the woods, they had intermittent internet connections, and an aversion to the new wave of high-modernist systems. Hence their interest in Earthstar.
  
The first thing they needed were keypairs for themselves:`,
);

const rabbitKeypair = await Earthstar.Crypto.generateAuthorKeypair("bunn");
const frogKeypair = await Earthstar.Crypto.generateAuthorKeypair("frog");

assert(!Earthstar.isErr(rabbitKeypair));
assert(!Earthstar.isErr(frogKeypair));

logRabbit(`My identity's address is ${rabbitKeypair.address}`);
logFrog(`And mine's ${frogKeypair.address}`);

logNarrator(
  `These keypairs would let them sign their data, so that they could know for certain who wrote what.`,
);

nextPartPrompt();

// In which we define a share address.
// =======================================================================

logNarrator(
  `They needed a spot to keep their data, and came up with an address they shared between themselves:`,
);

const shareKeyPair = await Earthstar.Crypto.generateShareKeypair("wimbleywoods");

assert(!Earthstar.isErr(shareKeyPair));

logRabbit(`Pssst... our share address is ${shareKeyPair.shareAddress}`);
logRabbit(`And the secret is ${shareKeyPair.secret}`);
logFrog("Cool, got it.");
logRabbit(`See you later!`);

logNarrator(`... and went their separate ways.`);

nextPartPrompt();

// In which we instantiate some replicas.
// =======================================================================

logNarrator(
  `When they got home, they each created their own 'Replica', their own personal copy of all the data kept in ${shareKeyPair.shareAddress}.`,
);

logRabbit(`Says here this thing needs a 'driver'...`);

const driverRabbit = new Earthstar.ReplicaDriverMemory(shareKeyPair.shareAddress);
const replicaRabbit = new Earthstar.Replica({ driver: driverRabbit, shareSecret: shareKeyPair.secret });

logReplica(`Greetings, User! I am ${replicaRabbit.replicaId}!`);

logNarrator("...");

logFrog("I wonder if there are other kinds of driver?");

const driverFrog = new Earthstar.ReplicaDriverMemory(shareKeyPair.shareAddress);
const replicaFrog = new Earthstar.Replica({ driver: driverFrog, shareSecret: shareKeyPair.secret });

logReplica(`Greetings, User! I am ${replicaFrog.replicaId}!`);

logFrog("Charmed.");

logNarrator("They had everything they needed.");

nextPartPrompt();

// In which frog writes some data.
// =======================================================================

logNarrator(
  "Now that they had their own replicas, they could write data to their heart's content. Frog got home first.",
);

logFrog("Right. Let's break this thing in...");
logFrog("So I have to choose a path to write my data to?");

const frogsFirstDoc = await replicaFrog.set(frogKeypair, {
  path: "/test",
  text:
    "I twisted the key. The 300 horsepower engine purred to life as I rested my webbed hand on the gearstick. Without hesitation I let the handbrake loose and roared into the distance. What awaited me over that horizon? Who can say...",
});

assert(!Earthstar.isErr(frogsFirstDoc));

logReplica("@frog wrote indulgent prose at /test");
console.group();
console.log(frogsFirstDoc);
console.groupEnd();

logFrog("Now I'm in the flow...");

const frogsSecondDoc = await replicaFrog.set(frogKeypair, {
  path: "/story_part_2",
  text:
    "\"I'm strictly liquor, love, and lies\" said the scaly beauty before me. I'd bitten off more than I could chew, that much was clear. Any other amphibian would have slid away like they tadpole they were. But me? I had plans. I took the plans out of my bag,",
});

assert(!Earthstar.isErr(frogsSecondDoc));

logReplica("@frog wrote more indulgent prose at /story_part_2");
console.group();
console.log(frogsSecondDoc);
console.groupEnd();

nextPartPrompt();

// In which rabbit writes some data.
// =======================================================================

logNarrator("And Rabbit returned home later after a leisurely stroll.");

logRabbit(
  `Any data I write needs to be at a particular 'path'...`,
);

const rabbitsFirstDoc = await replicaRabbit.set(rabbitKeypair, {
  path: "/test",
  text: "testy test...",
});

assert(!Earthstar.isErr(rabbitsFirstDoc));

logReplica("@bunn wrote some test data at /test");
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
logReplica("@bunn wrote a recipe at /carrot_soup");
console.group();
console.log(rabbitsSecondDoc);
console.groupEnd();

logNarrator(
  `... did you notice how they both wrote some data at /test?`,
);

nextPartPrompt();

// In which we instantiate some peers, and sync.
// =======================================================================

logNarrator(`The next morning they met up again.`);

logFrog("I got through my creative block last night! It's ribbeting stuff...");
logRabbit(
  "I know you prefer flies, but do give this carrot soup recipe a try sometime.",
);

logNarrator(
  "They could 'sync' their replicas so that they'd have each other's data.",
);

logRabbit(
  "First we both need to put our replicas in something called a 'Peer' to sync data.",
);

const peerRabbit = new Earthstar.Peer();
const peerFrog = new Earthstar.Peer();

peerRabbit.addReplica(replicaRabbit);
peerFrog.addReplica(replicaFrog);

logPeer("Greetings.");
logPeer("Howdy y'all!");

logFrog("Why does my one talk like that?");
logRabbit("Let's sync them.");

const syncer = peerRabbit.sync(peerFrog);

await syncer.isDone();

logPeer("Completed sync.");
logPeer("Yeehaw!");
logFrog("...");

logNarrator(
  "They looked inside their replicas and were somewhat surprised.",
);

nextPartPrompt();

// In which we inspect Rabbit's latest docs.
// =======================================================================

logNarrator("Rabbit was confused.");

logRabbit("I seem to be missing the first half of your story?");

const rabbitLatestDocs = await replicaRabbit.getLatestDocs();

logReplica("Got Rabbit's latest docs.");

console.group();
console.log(rabbitLatestDocs);
console.groupEnd();

nextPartPrompt();

// In which we inspect Frog's latest docs.
// =======================================================================

logNarrator("And Frog was hopping mad.");

logFrog("What happened to the first part of my story?! That's the best bit!");

const frogLatestDocs = await replicaRabbit.getLatestDocs();

logReplica("Got Frog's latest docs.");

console.group();
console.log(frogLatestDocs);
console.groupEnd();

logFrog("I don't even like soup!");

logNarrator("But things were working just as they should.");

nextPartPrompt();

// In which we inspect all versions of docs at a path.
// =======================================================================

logNarrator("And frog's story was far from lost.");

logPeer(`Chin up pardner'. I got yer' story right here.`);

logReplica("Got _all_ documents at /test");

const allDocsAtTest = await replicaFrog.getAllDocsAtPath("/test");

console.group();
console.log(allDocsAtTest);
console.groupEnd();

logFrog("There it is! My story!");
logRabbit("Oh, I have that document too...");
logPeer(
  "Thing is, Rabbit's doc was written after Frog's - so Rabbit's /test document is the top dog!",
);
logPeer(
  "But we still keep each author's last version so that no-one can lose their, uh, precious data.",
);
logFrog("<crying with joy>");

logRabbit(
  "There there. Maybe there's a way to have a place only you can write data to?",
);

logNarrator(
  "Could frog find a way to protect his story from being overwritten?",
);

nextPartPrompt();

// In which Frog writes to an owned path
// =======================================================================

logNarrator("He could.");

logFrog(
  "Looks like if you include your keypair's address in the path, prefixed by a tilde...",
);

const frogsOwnedDoc = await replicaFrog.set(frogKeypair, {
  path: `/~${frogKeypair.address}/stories/pt1`,
  text: frogsFirstDoc.doc.text,
});

console.group();
console.log(frogsOwnedDoc);
console.groupEnd();

assert(!Earthstar.isErr(frogsOwnedDoc));

logReplica("@frog re-wrote his story to an owned path!");
logRabbit("We should test this...");

const rabbitsAttempt = await replicaRabbit.set(rabbitKeypair, {
  path: `/~${frogKeypair.address}/stories/pt1`,
  text: frogsFirstDoc.doc.text,
});

try {
  assert(Earthstar.isErr(rabbitsAttempt));
} catch (error) {
  if (error == 'AssertionError') {
    logReplica("Error! @bunn tried to write to a path owned by @frog!");
  } else {
    logReplica("Error: " + error);
  }
}

logFrog("It worked! What other stuff can we do?");
logPeer("How about auto-destructing documents?");
logFrog("Yeah!");
logRabbit("Yeah!");

nextPartPrompt();

// In which Rabbit writes an ephemeral doc
// =======================================================================

logRabbit("Dear Frog, I will share with you a secret I never shared with anyone else for about ten seconds.");

const rabbitsStatusSecret = 'I accidentally stepped on the strawberries.';
const TIME_IN_SECONDS = 10 * 1E3;

const rabbitsConfession = await replicaRabbit.set(rabbitKeypair, {
  path: `/~${rabbitKeypair.address}/!secret`,
  // path: `/!secret`,
  text: rabbitsStatusSecret,
  deleteAfter: (Date.now() + TIME_IN_SECONDS) * 1000
});

logReplica(`Your secret is safe with me. I will keep it in storage until ${new Date(Date.now() + TIME_IN_SECONDS / 1E12).toISOString()}`);

console.group();
console.log(rabbitsConfession);
console.groupEnd();

const rabbitsConfessionDoc = await replicaRabbit.getLatestDocAtPath(`/~${rabbitKeypair.address}/!secret`);

assert(!Earthstar.isErr(rabbitsConfessionDoc));

logReplica("It's been less than the given expiration time, so here is the doc again.");

console.group();
console.log(rabbitsConfessionDoc);
console.groupEnd();

logFrog("Thank you for trusting me Bunn. My lips are sealed.");
logRabbit("I trust you Frog. You are a true friend.");

logNarrator("The friends just sit there. Enjoying each other's presence for a while.");

await delay(TIME_IN_SECONDS + 500);

logNarrator(`About ten seconds later, ${new Date(Date.now()).toISOString()}, Bunn checks if her secrets are no longer shared. For plausible deniability, you know...`);

const rabbitsSecretDoc = await replicaRabbit.getLatestDocAtPath(`/~${rabbitKeypair.address}/!secret`);

assert(!Earthstar.isErr(rabbitsSecretDoc));
assert(!rabbitsSecretDoc);

logReplica("Hmm, I don't seem to have this document any more!");

console.group();
console.log(rabbitsSecretDoc);
console.groupEnd();

logRabbit(
  "Sharing secrets really takes a load off, but I am glad this truth is no longer out there.",
);

logFrog("I feel we're getting even better friends now. Can I share a painting I made of you somehow too?");
logRabbit(
  "Let's find out how to do this here.",
);

logNarrator("Frog prepares a digital photograph of a painting he made of Bunn some time ago and gets it ready for sharing it.");

nextPartPrompt();


logNarrator("To be continued...");

// In which Frog saves some attachments
// =======================================================================

// In which Rabbit adds another share to his peer
// =======================================================================

// In which they start a server to sync over the internet?
// =======================================================================

Deno.exit(0);

// In which I write a bunch of utility functions
// =======================================================================

function nextPartPrompt() {
  const confirmed = confirm(`Continue?`);

  if (confirmed === false) {
    console.log(`
And so the story abruptly ended.
      `);
    logFrog("Are we still getting paid for this?");
    Deno.exit(0);
  } else {
    console.log(
      `%c
 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~`,
      "color: lightgrey;",
    );
  }
}

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

function logPeer(text: string) {
  console.log(`%c   🤖 ${text}`, "color: blue;");
}
