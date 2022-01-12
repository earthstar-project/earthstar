import { assertEquals, assertStrictEquals } from "../asserts.ts";

let TEST_NAME = "storage-cache";

import { Crypto } from "../../crypto/crypto.ts";
import { AuthorKeypair } from "../../util/doc-types.ts";
import { FormatValidatorEs4 } from "../../format-validators/format-validator-es4.ts";
import { StorageDriverAsyncMemory } from "../../storage/storage-driver-async-memory.ts";
import { StorageAsync } from "../../storage/storage-async.ts";
import { StorageCache } from "../../storage/storage-cache.ts";

// No types for tap...? Bit of a drag.

//-------------------

import { LogLevel, setDefaultLogLevel } from "../../util/log.ts";
import { sleep } from "../../util/misc.ts";

//setDefaultLogLevel(LogLevel.Debug);

//================================================================================

const WORKSPACE_ADDR = "+test.a123";

Deno.test("works", async () => {
    const keypair = await Crypto.generateAuthorKeypair("test") as AuthorKeypair;
    const keypairB = await Crypto.generateAuthorKeypair(
        "suzy",
    ) as AuthorKeypair;

    const storage = new StorageAsync(
        WORKSPACE_ADDR,
        FormatValidatorEs4,
        new StorageDriverAsyncMemory(WORKSPACE_ADDR),
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

    assertEquals(values.allDocs, []);
    assertEquals(values.latestDocs, []);
    assertStrictEquals(values.orangesDoc, undefined);

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

    assertStrictEquals(values.allDocs.length, 3);
    assertStrictEquals(values.latestDocs.length, 3);
    assertStrictEquals(values.orangesDoc?.path, "/test/oranges.txt");
    assertStrictEquals(values.orangesDoc?.author, keypair.address);

    cache._storage.set(keypairB, {
        content: "Suzy's Oranges!",
        path: "/test/oranges.txt",
        format: "es.4",
    });

    await sleep(100);

    assertStrictEquals(values.allDocs.length, 4);
    assertStrictEquals(values.latestDocs.length, 3);
    assertStrictEquals(values.orangesDoc?.path, "/test/oranges.txt");
    assertStrictEquals(values.orangesDoc?.author, keypairB.address);
});
