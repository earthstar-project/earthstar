import t from "tap";
import { onFinishOneTest } from '../browser-run-exit';

let TEST_NAME = 'storage-cache';

// Boilerplate to help browser-run know when this test is completed.
// When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function.
/* istanbul ignore next */ 
(t.test as any)?.onFinish?.(() => onFinishOneTest(TEST_NAME));

import { Crypto } from '../../crypto/crypto';
import { AuthorKeypair } from "../../util/doc-types";
import { FormatValidatorEs4 } from "../../format-validators/format-validator-es4";
import { StorageDriverAsyncMemory } from "../../storage/storage-driver-async-memory";
import { StorageAsync } from "../../storage/storage-async";
import { StorageCache } from "../../storage/storage-cache";

// No types for tap...? Bit of a drag.

//-------------------

import {
    LogLevel,
    setDefaultLogLevel,
} from '../../util/log';
import { sleep } from "../../util/misc";

//setDefaultLogLevel(LogLevel.Debug);

//================================================================================

const WORKSPACE_ADDR = "+test.a123";

t.test("works", async (t: any) => {
  const keypair = await Crypto.generateAuthorKeypair("test") as AuthorKeypair;
  const keypairB = await Crypto.generateAuthorKeypair("suzy") as AuthorKeypair;

  const storage = new StorageAsync(
    WORKSPACE_ADDR,
    FormatValidatorEs4,
    new StorageDriverAsyncMemory(WORKSPACE_ADDR)
  );

  const cache = new StorageCache(storage);

  const values = {
    allDocs: cache.getAllDocs(),
    latestDocs: cache.getLatestDocs(),
    orangesDoc: cache.getLatestDocAtPath("/test/oranges.txt"),
  };

  cache.onCacheUpdated(() => {
    values.allDocs = cache.getAllDocs();
    values.latestDocs = cache.getLatestDocs();
    values.orangesDoc = cache.getLatestDocAtPath("/test/oranges.txt");
  });

  t.same(values.allDocs, []);
  t.same(values.latestDocs, []);
  t.equals(values.orangesDoc, undefined);

  cache._storage.set(keypair, {
    content: "Hello!",
    path: "/test/hello.txt",
    format: "es.4",
  });

  cache._storage.set(keypair, {
    content: "Apples!",
    path: "/test/apples.txt",
    format: "es.4",
  });

  cache._storage.set(keypair, {
    content: "Oranges!",
    path: "/test/oranges.txt",
    format: "es.4",
  });
  
  await sleep(100);

  t.equals(values.allDocs.length, 3);
  t.equals(values.latestDocs.length, 3);
  t.equals(values.orangesDoc?.path, "/test/oranges.txt");
  t.equals(values.orangesDoc?.author, keypair.address);

  cache._storage.set(keypairB, {
    content: "Suzy's Oranges!",
    path: "/test/oranges.txt",
    format: "es.4",
  });
  
  await sleep(100);

  t.equals(values.allDocs.length, 4);
  t.equals(values.latestDocs.length, 3);
  t.equals(values.orangesDoc?.path, "/test/oranges.txt");
  t.equals(values.orangesDoc?.author, keypairB.address);

  t.end();
});
