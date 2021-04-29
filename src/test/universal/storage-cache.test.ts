import t from "tap";
// Boilerplate to help browser-run know when this test is completed (see browser-run.ts)
// When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function..
declare let window: any;
if ((t.test as any).onFinish) {
  (t.test as any).onFinish(() => window.onFinish("base32"));
}

import { StorageCache } from "../../storage/storage-cache";
import { StorageAsync } from "../../storage/storage-async";
import { StorageDriverAsyncMemory } from "../../storage/storage-driver-async-memory";
import { FormatValidatorEs4 } from "../../format-validators/format-validator-es4";
import { Crypto } from "../../crypto/crypto";
import { CryptoDriverTweetnacl } from "../../crypto/crypto-driver-tweetnacl";
import { AuthorKeypair, Doc } from "../../util/doc-types";

// No types for tap...? Bit of a drag.

const WORKSPACE_ADDR = "+test.a123";

t.test("works", (t: any) => {
  const crypto = new Crypto(CryptoDriverTweetnacl);

  const keypair = crypto.generateAuthorKeypair("test") as AuthorKeypair;
  const keypairB = crypto.generateAuthorKeypair("suzy") as AuthorKeypair;

  const storage = new StorageAsync(
    WORKSPACE_ADDR,
    new FormatValidatorEs4(crypto),
    new StorageDriverAsyncMemory(WORKSPACE_ADDR)
  );

  const cache = new StorageCache(storage);

  const values = {
    allDocs: cache.getAllDocs(),
    latestDocs: cache.getLatestDocs(),
    orangesDoc: cache.getLatestDocAtPath("/test/oranges.txt"),
  };

  cache.onStale(() => {
    values.allDocs = cache.getAllDocs();
    values.latestDocs = cache.getLatestDocs();
    values.orangesDoc = cache.getLatestDocAtPath("/test/oranges.txt");
  });

  t.same(values.allDocs, []);
  t.same(values.latestDocs, []);
  t.equals(values.orangesDoc, undefined);

  cache.set(keypair, {
    content: "Hello!",
    path: "/test/hello.txt",
    format: "es.4",
    workspace: WORKSPACE_ADDR,
  });

  cache.set(keypair, {
    content: "Apples!",
    path: "/test/apples.txt",
    format: "es.4",
    workspace: WORKSPACE_ADDR,
  });

  cache.set(keypair, {
    content: "Oranges!",
    path: "/test/oranges.txt",
    format: "es.4",
    workspace: WORKSPACE_ADDR,
  });

  t.equals(values.allDocs.length, 3);
  t.equals(values.latestDocs.length, 3);
  t.equals(values.orangesDoc?.path, "/test/oranges.txt");
  t.equals(values.orangesDoc?.author, keypair.address);

  cache.set(keypairB, {
    content: "Suzy's Oranges!",
    path: "/test/oranges.txt",
    format: "es.4",
    workspace: WORKSPACE_ADDR,
  });

  t.equals(values.allDocs.length, 4);
  t.equals(values.latestDocs.length, 3);
  t.equals(values.orangesDoc?.path, "/test/oranges.txt");
  t.equals(values.orangesDoc?.author, keypairB.address);

  t.end();
});
