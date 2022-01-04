import { assert, assertEquals } from "../asserts.ts";

import { Lock } from "../../../deps.ts";

import { sleep } from "../../util/misc.ts";

let TEST_NAME = "lock";

//================================================================================

Deno.test("opts", async () => {
  let lock = new Lock<any>();

  assertEquals(
    await lock.run(async () => {
      return 123;
    }),
    123,
  );
  assertEquals(
    await lock.run(async () => {
      return 123;
    }, {}),
    123,
  );
  assertEquals(
    await lock.run(async () => {
      return 123;
    }, { bypass: false }),
    123,
  );
  assertEquals(
    await lock.run(async () => {
      return 123;
    }, { bypass: true }),
    123,
  );
});

Deno.test("bypass timing", async () => {
  let lock = new Lock<any>();
  let logs: string[] = ["-start"];

  let prom = lock.run(async () => {
    logs.push("callback-with-bypass");
  }, { bypass: true });

  logs.push("-await");
  await prom;
  logs.push("-end");

  let expectedLogs = [
    "-start",
    "-await",
    "callback-with-bypass",
    "-end",
  ];
  assertEquals(logs, expectedLogs, "logs are in expected order");
});

Deno.test("non-bypass timing", async () => {
  let lock = new Lock<any>();
  let logs: string[] = ["-start"];

  let prom = lock.run(async () => {
    logs.push("callback");
  });

  logs.push("-await");
  await prom;
  logs.push("-end");

  let expectedLogs = [
    "-start",
    "-await",
    "callback",
    "-end",
  ];
  assertEquals(logs, expectedLogs, "logs are in expected order");
});

Deno.test("bypass run in parallel with normal lock callbacks", async () => {
  let lock = new Lock<any>();

  let logs: string[] = ["-start"];

  let promA = lock.run(async () => {
    logs.push("a1");
    await sleep(30);
    logs.push("a2");
    return "a";
  });
  let promBypass = lock.run(async () => {
    logs.push("b1");
    await sleep(40);
    logs.push("b2");
    return "b";
  }, { bypass: true });
  let promC = lock.run(async () => {
    logs.push("c1");
    await sleep(30);
    logs.push("c2");
    return "c";
  });

  logs.push("-await");
  let valA = await promA;
  let valB = await promBypass;
  let valC = await promC;
  logs.push("-end");

  let expectedLogs = [
    "-start",
    "-await",
    // a runs
    "a1",
    "b1", // b ignores the lock and runs while a is running
    "a2",
    // c runs
    "c1",
    "b2", // b finishes while c is running
    "c2",
    "-end",
  ];
  assertEquals(logs, expectedLogs, "logs are in expected order");
  assertEquals(valA, "a", "value is correct");
  assertEquals(valB, "b", "value is correct from bypass");
  assertEquals(valC, "c", "value is correct");
});

Deno.test("lock returning a value", async () => {
  let lock = new Lock<any>();

  let result = await lock.run(async () => {
    return 123;
  });
  assertEquals(result, 123, "got expected result back from callback");
});

Deno.test("lock running in serial with await", async () => {
  let lock = new Lock<any>();

  let logs: string[] = ["-start"];

  await lock.run(async () => {
    logs.push("1a");
    await sleep(60);
    logs.push("1b");
  });
  await lock.run(async () => {
    logs.push("2a");
    await sleep(60);
    logs.push("2b");
  });

  logs.push("-end");

  let expectedLogs = [
    "-start",
    "1a",
    "1b",
    "2a",
    "2b",
    "-end",
  ];
  assertEquals(logs, expectedLogs, "logs are in expected order");
});

Deno.test("lock trying to run in parallel", async () => {
  let lock = new Lock<any>();

  let logs: string[] = ["-start"];
  let results: number[] = [];

  let proms = [];
  proms.push(lock.run(async () => {
    logs.push("1a");
    await sleep(60);
    logs.push("1b");
    return 1;
  }));
  proms.push(lock.run(async () => {
    logs.push("2a");
    await sleep(60);
    logs.push("2b");
    return 2;
  }));
  logs.push("-first sleep");
  await sleep(50);
  proms.push(lock.run(async () => {
    logs.push("3a");
    await sleep(60);
    logs.push("3b");
    return 3;
  }));

  for (let prom of proms) {
    results.push(await prom);
  }

  logs.push("-end");

  let expectedLogs = [
    "-start",
    "-first sleep",
    "1a",
    "1b",
    "2a",
    "2b",
    "3a",
    "3b",
    "-end",
  ];
  assertEquals(logs, expectedLogs, "logs are in expected order");
  assertEquals(results, [1, 2, 3], "results are in expected order");
});

Deno.test("lock recursive", async () => {
  let lock = new Lock<any>();

  let logs: string[] = ["-start"];

  let proms = [];
  proms.push(lock.run(async () => {
    logs.push("1a");
    await sleep(60);
    logs.push("1b");
  }));
  proms.push(lock.run(async () => {
    // This is not really a true recursive lock.
    // We're just making a new Lock inside the run function of another Lock
    let innerLock = new Lock();
    logs.push("2a");
    sleep(10);

    let innerProms = [];
    innerProms.push(innerLock.run(async () => {
      logs.push("2a-1a");
      await sleep(60);
      logs.push("2a-1b");
    }));
    innerProms.push(innerLock.run(async () => {
      logs.push("2a-2a");
      await sleep(60);
      logs.push("2a-2b");
    }));
    innerProms.push(innerLock.run(async () => {
      logs.push("2a-3a");
      await sleep(60);
      logs.push("2a-3b");
    }));
    logs.push("2a-promise.all");
    await Promise.all(innerProms);

    sleep(10);
    logs.push("2b");
  }));
  proms.push(lock.run(async () => {
    logs.push("3a");
    await sleep(60);
    logs.push("3b");
  }));

  logs.push("-promise.all");
  await Promise.all(proms);
  logs.push("-end");

  let expectedLogs = [
    "-start",
    "-promise.all",
    "1a",
    "1b",
    "2a",
    "2a-promise.all",
    "2a-1a",
    "2a-1b",
    "2a-2a",
    "2a-2b",
    "2a-3a",
    "2a-3b",
    "2b",
    "3a",
    "3b",
    "-end",
  ];
  assertEquals(logs, expectedLogs, "logs are in expected order");
});

Deno.test("lock error handling", async () => {
  let lock = new Lock<any>();

  try {
    await lock.run(async () => {
      throw new Error("kaboom");
    });
    assert(false, "error was not caught");
  } catch (err: any) {
    assert(true, "error was caught");
    assertEquals(err.message, "kaboom", "it was the same error");
  }

  try {
    await lock.run(async () => {
      throw new Error("kaboom");
    }, { bypass: true });
    assert(false, "error was not caught with bypass");
  } catch (err: any) {
    assert(true, "error was caught with bypass");
    assertEquals(err.message, "kaboom", "it was the same error");
  }
});
