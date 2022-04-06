import {
  AuthorKeypair,
  Crypto,
  FormatValidatorEs4,
  isErr,
  LiveQueryEvent,
  Logger,
  LogLevel,
  Peer,
  QueryFollower,
  Replica,
  ReplicaDriverMemory,
  setDefaultLogLevel,
  setLogLevel,
  sleep,
} from "./mod.ts";

//--------------------------------------------------

let loggerMain = new Logger("main", "whiteBright");
let loggerBusEvents = new Logger("main storage bus events", "white");
let loggerQueryFollowerCallbacks1 = new Logger(
  "main query follower 1 callback",
  "red",
);
let loggerQueryFollowerCallbacks2 = new Logger(
  "main query follower 2 callback",
  "red",
);
let loggerPeerMapEvents = new Logger("peer map event", "redBright");

setDefaultLogLevel(LogLevel.Debug);
setLogLevel("main", LogLevel.Debug);

//================================================================================

let main = async () => {
  let share = "+gardening.abc";

  // setup
  loggerMain.blank();
  loggerMain.blank();
  loggerMain.blank();
  loggerMain.info("-----------\\");
  loggerMain.info("setup");
  loggerMain.info("share =", share);
  //loggerMain.info('set global crypto driver')
  //setGlobalCryptoDriver(CryptoDriverTweetnacl);  // this is the default
  loggerMain.info("instantiate storageDriver and storage");
  let storageDriver = new ReplicaDriverMemory(share);
  let storage = new Replica(
    share,
    FormatValidatorEs4,
    storageDriver,
  );

  let peer = new Peer();
  peer.replicaMap.bus.on("*", (channel, data) => {
    loggerPeerMapEvents.debug(`${channel}`);
  });
  peer.addReplica(storage);

  loggerMain.info("generate a keypair");
  let keypair = await Crypto.generateAuthorKeypair("suzy") as AuthorKeypair;
  if (isErr(keypair)) {
    console.error(keypair);
    Deno.exit(1);
  }
  loggerMain.info("    keypair =", keypair);
  loggerMain.info("-----------/");

  loggerMain.blank();
  loggerMain.blank();
  loggerMain.blank();
  loggerMain.info("-----------\\");
  loggerMain.info("adding a queryFollower");
  // add a QueryFollower
  let qf1 = new QueryFollower(
    storage,
    {
      historyMode: "all",
      orderBy: "localIndex ASC",
      //startAfter: { localIndex: 1 },
      //filter: { path: '/posts/post-0001.txt' },
    },
  );

  qf1.bus.on(async (event: LiveQueryEvent) => {
    if (event.kind === "existing") {
      loggerQueryFollowerCallbacks1.debug(
        "got an existing doc",
        event.doc,
      );
    } else if (event.kind === "idle") {
      loggerQueryFollowerCallbacks1.debug(
        "query follower is caught up, switching to live mode",
      );
    } else if (event.kind === "success") {
      loggerQueryFollowerCallbacks1.debug("got a new doc", event.doc);
    } else if (event.kind === "queryFollowerDidClose") {
      loggerQueryFollowerCallbacks1.debug("query follower closed");
    }
  });
  loggerMain.info("hatching it");
  await qf1.hatch();
  loggerMain.info("-----------/");

  // write some docs
  loggerMain.blank();
  loggerMain.blank();
  loggerMain.blank();
  loggerMain.info("-----------\\");
  let numDocsToWrite = 2;
  loggerMain.info(`setting ${numDocsToWrite} docs`);
  for (let ii = 0; ii < numDocsToWrite; ii++) {
    loggerMain.blank();
    loggerMain.info(`setting #${ii}`);
    let result = await storage.set(keypair, {
      format: "es.4",
      path: `/posts/post-${("" + ii).padStart(4, "0")}.txt`,
      content: `Hello ${ii}`,
    });
    loggerMain.info("    set result", result);
  }
  loggerMain.info("-----------/");

  // get all docs
  loggerMain.blank();
  loggerMain.blank();
  loggerMain.blank();
  loggerMain.info("-----------\\");
  loggerMain.info("getting all docs");
  let allDocs = await storage.getAllDocs();
  for (let ii = 0; ii < allDocs.length; ii++) {
    loggerMain.info(`doc ${ii + 1} of ${allDocs.length}:`, allDocs[ii]);
  }
  loggerMain.info("-----------/");

  // add another QueryFollower
  // now that we have some docs, this will have to catch up
  loggerMain.blank();
  loggerMain.blank();
  loggerMain.blank();
  loggerMain.info("-----------\\");
  loggerMain.info("adding a queryFollower");
  let qf2 = new QueryFollower(
    storage,
    {
      historyMode: "all",
      orderBy: "localIndex ASC",
      //startAfter: { localIndex: 1 },
      //filter: { path: '/posts/post-0000.txt' },
    },
  );
  qf2.bus.on(async (event: LiveQueryEvent) => {
    if (event.kind === "existing") {
      loggerQueryFollowerCallbacks2.debug(
        "got an existing doc",
        event.doc,
      );
    } else if (event.kind === "idle") {
      loggerQueryFollowerCallbacks2.debug(
        "query follower is caught up, switching to live mode",
      );
    } else if (event.kind === "success") {
      loggerQueryFollowerCallbacks2.debug("got a new doc", event.doc);
    } else if (event.kind === "queryFollowerDidClose") {
      loggerQueryFollowerCallbacks2.debug("query follower closed");
    }
  });
  loggerMain.info("hatching it");
  await qf2.hatch();
  loggerMain.info("-----------/");

  // sleep
  loggerMain.blank();
  loggerMain.blank();
  loggerMain.blank();
  loggerMain.info("---------------------------------------");
  loggerMain.info("-----------------------------------------");
  loggerMain.info("-------------------------------------------");
  loggerMain.info("sleep 100");
  loggerMain.blank();
  loggerMain.blank();
  loggerMain.blank();
  await sleep(100);
  loggerMain.blank();
  loggerMain.blank();
  loggerMain.blank();
  loggerMain.info("done sleeping 100");
  loggerMain.info("-------------------------------------------");
  loggerMain.info("-----------------------------------------");
  loggerMain.info("---------------------------------------");

  storage.bus.on("willClose", async () => {
    loggerBusEvents.debug("storage willClose... sleeping 1 second...");
    await sleep(1000);
    loggerBusEvents.debug("...storage willClose done.");
  }, { mode: "blocking" });

  storage.bus.on("didClose", async () => {
    loggerBusEvents.debug("storage didClose... sleeping 1 second...");
    await sleep(1000);
    loggerBusEvents.debug("...storage didClose done.");
  }, { mode: "nonblocking" });

  loggerMain.blank();
  loggerMain.blank();
  loggerMain.blank();
  loggerMain.info("closing storage");
  loggerMain.info("-------------------------------------------");
  await storage.close(true); // erase=true for this example, but normally use erase=false
  loggerMain.info("-------------------------------------------");
  loggerMain.blank();
  loggerMain.blank();
  loggerMain.blank();
};
main();
