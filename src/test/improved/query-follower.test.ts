import { assert, assertEquals, assertThrows } from "../asserts.ts";
import { AuthorKeypair, WorkspaceAddress } from "../../util/doc-types.ts";
import { IStorageAsync, LiveQueryEvent } from "../../storage/storage-types.ts";
import { Query } from "../../query/query-types.ts";
import { isErr } from "../../util/errors.ts";
import { microsecondNow, sleep } from "../../util/misc.ts";
import { Crypto } from "../../crypto/crypto.ts";
import { GlobalCryptoDriver } from "../../crypto/global-crypto-driver.ts";
import { FormatValidatorEs4 } from "../../format-validators/format-validator-es4.ts";
import { StorageAsync } from "../../storage/storage-async.ts";

import { TestScenario } from "../test-scenario-types.ts";
import { testScenarios } from "../test-scenarios.ts";

//================================================================================

import { Logger, LogLevel, setLogLevel } from "../../util/log.ts";
import { QueryFollower } from "../../query-follower/query-follower.ts";
let loggerTest = new Logger("test", "whiteBright");
let loggerTestCb = new Logger("test cb", "white");
let J = JSON.stringify;

//setLogLevel('test', LogLevel.Debug);
//setLogLevel('test cb', LogLevel.Debug);

//================================================================================

//======

let runQueryFollowerTests = (scenario: TestScenario) => {
  let TEST_NAME = "QueryFollower tests";
  let SUBTEST_NAME = scenario.name;

  let makeStorage = (ws: WorkspaceAddress): IStorageAsync => {
    let driver = scenario.makeDriver(ws);
    return new StorageAsync(ws, FormatValidatorEs4, driver);
  };

  Deno.test(SUBTEST_NAME + ": query rules", async () => {
    let initialCryptoDriver = GlobalCryptoDriver;

    let workspace = "+gardening.abcde";
    let storage = makeStorage(workspace);
    let author1 = Crypto.generateAuthorKeypair("onee");
    if (isErr(author1)) {
      await storage.close(true);
      assert(false, "generate author failed");
    }

    interface Vector {
      query: Query;
      isValid: Boolean;
      note?: string;
    }
    let vectors: Vector[] = [
      {
        isValid: true,
        query: { historyMode: "all", orderBy: "localIndex ASC" },
      },
      {
        isValid: true,
        query: {
          historyMode: "all",
          orderBy: "localIndex ASC",
          startAfter: { localIndex: 123 },
        },
      },
      {
        isValid: true,
        query: {
          historyMode: "all",
          orderBy: "localIndex ASC",
          filter: { path: "/foo/" },
        },
      },

      {
        isValid: false,
        query: { historyMode: "latest", orderBy: "localIndex ASC" },
      },
      {
        isValid: false,
        query: { historyMode: "all", orderBy: "localIndex DESC" },
      },
      {
        isValid: false,
        query: { historyMode: "all", orderBy: "localIndex ASC", limit: 123 },
      },
      { isValid: false, query: { orderBy: "localIndex ASC" } },
      { isValid: false, query: { historyMode: "all" } },
      { isValid: false, query: {} },
    ];

    for (let { query, isValid, note } of vectors) {
      let makeFollower = () => {
        let qf = new QueryFollower(storage, query);
        return qf;
      };
      if (isValid) {
        assert(makeFollower, "valid:   " + (note || J(query)));
      } else {
        assertThrows(
          makeFollower,
          undefined,
          undefined,
          "invalid: " + (note || J(query)),
        );
      }
    }

    await storage.close(true);
    assertEquals(
      initialCryptoDriver,
      GlobalCryptoDriver,
      `GlobalCryptoDriver has not changed unexpectedly.  started as ${
        (initialCryptoDriver as any).name
      }, ended as ${(GlobalCryptoDriver as any).name}`,
    );
  });

  Deno.test(SUBTEST_NAME + ": basics", async () => {
    let initialCryptoDriver = GlobalCryptoDriver;

    loggerTest.debug("begin");

    let logs: string[] = ["-begin"];

    let workspace = "+gardening.abcde";
    let storage = makeStorage(workspace);

    let keypair1 = await Crypto.generateAuthorKeypair("aaaa");
    let keypair2 = await Crypto.generateAuthorKeypair("bbbb");
    if (isErr(keypair1) || isErr(keypair2)) {
      assert(false, "error making keypair");
    }

    //--------------------------------------------------
    loggerTest.debug("testing disallowed live queries");
    assertThrows(
      () => {
        let query: Query = {
          historyMode: "latest",
          orderBy: "localIndex ASC",
          startAfter: { localIndex: -1 }, // start at beginning
        };
        let qf = new QueryFollower(storage, query);
      },
      undefined,
      undefined,
      "liveQuery does not allow historyMode latest",
    );
    assertThrows(
      () => {
        let query: Query = {
          historyMode: "all",
          orderBy: "localIndex DESC",
          startAfter: { localIndex: -1 }, // start at beginning
        };
        let qf = new QueryFollower(storage, query);
      },
      undefined,
      undefined,
      "liveQuery requires orderBy localIndex ASC",
    );
    assertThrows(
      () => {
        let query: Query = {
          historyMode: "all",
          orderBy: "localIndex ASC",
          startAfter: { localIndex: -1 }, // start at beginning
          limit: 123,
        };
        let qf = new QueryFollower(storage, query);
      },
      undefined,
      undefined,
      "liveQuery may not have a limit",
    );

    //--------------------------------------------------
    // write initial docs, before we begin the query follower

    let now = microsecondNow();
    loggerTest.debug("write doc 0");
    await storage.set(keypair1, {
      format: "es.4",
      path: "/apple",
      content: "crunchy0",
      timestamp: now + 0,
    });

    loggerTest.debug("write doc 1");
    await storage.set(keypair1, {
      format: "es.4",
      path: "/cherry",
      content: "crispy1",
      timestamp: now + 1,
    });

    //--------------------------------------------------
    // set up the query follower

    let query: Query = {
      historyMode: "all",
      orderBy: "localIndex ASC",
      //filter: { path: '/apple' },
      startAfter: { localIndex: -1 }, // start at beginning
    };
    let qf = new QueryFollower(storage, query);
    assertEquals(qf.state(), "new", 'state should be "new" before hatching');

    //--------------------------------------------------
    // subscribe to query follower events

    qf.bus.on((event: LiveQueryEvent) => {
      loggerTestCb.debug(">>>>>>>>>>>>>>>>", event);
      if (event.kind && event.kind === "existing") {
        logs.push(
          `> ${event.kind}: ${event.doc.path} = ${event.doc.content} (index ${event.doc._localIndex})`,
        );
      } else if (event.kind && event.kind === "success") {
        logs.push(
          `> ${event.kind}: ${event.doc.path} = ${event.doc.content} (index ${event.doc._localIndex})`,
        );
      } else if (event.kind) {
        logs.push(`> ${event.kind}`);
      } else {
        logs.push(`> ???`);
      }
    });

    //--------------------------------------------------
    // kick things off

    await qf.hatch();
    assertEquals(qf.state(), "live", 'state should be "live" after hatching');

    // sleep so query follower can catch up
    await sleep(50);

    loggerTest.debug("write doc 2");
    await storage.set(keypair2, {
      format: "es.4",
      path: "/apple",
      content: "juicy2",
      timestamp: now + 2,
    });

    loggerTest.debug("write doc 3");
    await storage.set(keypair2, {
      format: "es.4",
      path: "/banana",
      content: "yellow3",
      timestamp: now + 3,
    });

    loggerTest.debug("sleep so query follower can catch up");
    await sleep(50);

    loggerTest.debug("write doc 4");
    await storage.set(keypair2, {
      format: "es.4",
      path: "/peach",
      content: "orange4",
      timestamp: now + 4,
    });

    loggerTest.debug("close the storage");
    await storage.close(true);

    loggerTest.debug("sleep so didClose has time to happen");
    await sleep(50);

    logs.push("-end");
    let expectedLogs = [
      "-begin",
      "> existing: /apple = crunchy0 (index 0)",
      "> existing: /cherry = crispy1 (index 1)",
      "> idle", // caught up
      "> success: /apple = juicy2 (index 2)",
      "> success: /banana = yellow3 (index 3)",
      "> success: /peach = orange4 (index 4)",
      "> willClose",
      "> didClose",
      "> queryFollowerDidClose",
      "-end",
    ];
    assertEquals(logs, expectedLogs, "logs match");

    assertEquals(
      initialCryptoDriver,
      GlobalCryptoDriver,
      `GlobalCryptoDriver has not changed unexpectedly.  started as ${
        (initialCryptoDriver as any).name
      }, ended as ${(GlobalCryptoDriver as any).name}`,
    );

    await qf.close();
  });

  Deno.test(SUBTEST_NAME + ": fuzz test", async () => {
    let initialCryptoDriver = GlobalCryptoDriver;

    loggerTest.debug("begin");

    let logs: string[] = ["-begin"];

    let workspace = "+gardening.abcde";
    let storage = makeStorage(workspace);

    let keypair1 = await Crypto.generateAuthorKeypair("aaaa");
    let keypair2 = await Crypto.generateAuthorKeypair("bbbb");
    if (isErr(keypair1) || isErr(keypair2)) {
      assert(false, "error making keypair");
    }

    // set a bunch of sequential documents
    let addDocs = async (
      storage: IStorageAsync,
      keypair: AuthorKeypair,
      startAt: number,
      endAt: number,
    ): Promise<void> => {
      let ii = startAt;
      while (ii <= endAt) {
        await storage.set(keypair, {
          format: "es.4",
          path: "/test/" + Math.random(),
          content: "" + ii,
          timestamp: microsecondNow(),
        });
        ii++;
      }
    };

    // add some initial documents...
    await addDocs(storage, keypair1, 0, 20);

    // set up a query follower...
    let itemsFound: number[] = [];
    let qf = new QueryFollower(storage, {
      historyMode: "all",
      orderBy: "localIndex ASC",
      startAfter: { localIndex: -1 },
    });
    qf.bus.on((event: LiveQueryEvent) => {
      if (event.kind === "existing" || event.kind === "success") {
        itemsFound.push(+event.doc.content);
      }
    });

    // let it catch up...
    await qf.hatch();

    // add more docs
    await addDocs(storage, keypair1, 21, 40);
    await sleep(30);
    await addDocs(storage, keypair1, 41, 50);

    // TODO-DENO: closing the storage leaks async ops?
    await qf.close();

    let expectedItemsFound = [...Array(51).keys()];
    assertEquals(
      itemsFound,
      expectedItemsFound,
      "each item should occur once, in order",
    );

    assertEquals(
      initialCryptoDriver,
      GlobalCryptoDriver,
      `GlobalCryptoDriver has not changed unexpectedly.  started as ${
        (initialCryptoDriver as any).name
      }, ended as ${(GlobalCryptoDriver as any).name}`,
    );
  });

  // TODO: try closing the queryfollower from inside its own bus event handler -- this might cause a deadlock
};

for (let scenario of testScenarios) {
  runQueryFollowerTests(scenario);
}
