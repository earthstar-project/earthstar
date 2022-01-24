import { assertEquals } from "../asserts.ts";
import { throws } from "../test-utils.ts";
import { Doc } from "../../util/doc-types.ts";
import { Query } from "../../query/query-types.ts";
import { GlobalCryptoDriver } from "../../crypto/global-crypto-driver.ts";

import { TestScenario } from "../test-scenario-types.ts";
import { testScenarios } from "../test-scenarios.ts";

//================================================================================

import { LogLevel, setDefaultLogLevel } from "../../util/log.ts";
//setDefaultLogLevel(LogLevel.Debug);
let J = JSON.stringify;

//================================================================================

export function runStorageDriverTests(scenario: TestScenario) {
    let TEST_NAME = "storage-driver shared tests";
    let SUBTEST_NAME = scenario.name;

    Deno.test(SUBTEST_NAME + ": empty storage, close", async () => {
        let initialCryptoDriver = GlobalCryptoDriver;

        let workspace = "+gardening.abcde";
        let driver = scenario.makeDriver(workspace);

        assertEquals(
            driver.getMaxLocalIndex(),
            -1,
            "maxLocalIndex starts at -1",
        );
        assertEquals(
            await driver.queryDocs({}),
            [],
            "query returns empty array",
        );

        await driver.close(true);
        assertEquals(driver.isClosed(), true, "isClosed");

        await throws(
            async () => driver.getMaxLocalIndex(),
            "getMaxLocalIndex throws when closed",
        );
        await throws(
            async () => await driver.queryDocs({}),
            "queryDocs throws when closed",
        );
        await throws(
            async () => await driver.upsert({} as any),
            "upsert throws when closed",
        );

        assertEquals(
            initialCryptoDriver,
            GlobalCryptoDriver,
            `GlobalCryptoDriver has not changed unexpectedly.  started as ${
                (initialCryptoDriver as any).name
            }, ended as ${(GlobalCryptoDriver as any).name}`,
        );
    });

    Deno.test(SUBTEST_NAME + ": config", async () => {
        let initialCryptoDriver = GlobalCryptoDriver;

        let workspace = "+gardening.abcde";
        let driver = scenario.makeDriver(workspace);

        // empty...
        assertEquals(
            await driver.getConfig("foo"),
            undefined,
            `getConfig('nonexistent') --> undefined`,
        );
        assertEquals(
            await driver.listConfigKeys(),
            [],
            `listConfigKeys() is []`,
        );
        assertEquals(
            await driver.deleteConfig("foo"),
            false,
            `deleteConfig('nonexistent') --> false`,
        );

        // set some items...
        await driver.setConfig("b", "bb");
        await driver.setConfig("a", "aa");

        // after adding some items...
        assertEquals(await driver.getConfig("a"), "aa", `getConfig works`);
        assertEquals(
            await driver.listConfigKeys(),
            ["a", "b"],
            `listConfigKeys() is ['a', 'b'] (sorted)`,
        );

        assertEquals(
            await driver.deleteConfig("a"),
            true,
            "delete returns true on success",
        );
        assertEquals(
            await driver.deleteConfig("a"),
            false,
            "delete returns false if nothing is there",
        );
        assertEquals(
            await driver.getConfig("a"),
            undefined,
            `getConfig returns undefined after deleting the key`,
        );

        await driver.close(true);
        assertEquals(
            initialCryptoDriver,
            GlobalCryptoDriver,
            `GlobalCryptoDriver has not changed unexpectedly.  started as ${
                (initialCryptoDriver as any).name
            }, ended as ${(GlobalCryptoDriver as any).name}`,
        );
    });

    Deno.test(
        SUBTEST_NAME + ": upsert and basic querying with one path",
        async () => {
            let initialCryptoDriver = GlobalCryptoDriver;

            let workspace = "+gardening.abcde";
            let driver = scenario.makeDriver(workspace);

            let doc0: Doc = {
                format: "es.4",
                author: "@suzy.bolxx3bc6gmoa43rr5qfgv6r65zbqjwtzcnr7zyef2hvpftw45clq",
                content: "Hello 0",
                contentHash: "bnkc2f3fbdfpfeanwcgbid4t2lanmtq2obsvijhsagmn3x652h57a",
                deleteAfter: null,
                path: "/posts/post-0000.txt",
                timestamp: 1619627796035000,
                workspace: "+gardening.abc",
                signature: "whatever0", // upsert does not check signature or validate doc
            };
            // same author, newer
            let doc1 = {
                ...doc0,
                content: "Hello 1",
                timestamp: doc0.timestamp + 1, // make sure this one wins
                signature: "whatever1", // everything assumes different docs have different sigs
            };
            // second author, newer still
            let doc2 = {
                ...doc0,
                author: "@timm.baaaaaaaaaaaaaaaaaaaaaaaaazbqjwtzcnr7zyef2hvpftw45clq",
                content: "Hello 2",
                timestamp: doc0.timestamp + 2, // make sure this one wins
                signature: "whatever2", // everything assumes different docs have different sigs
            };
            // second author, older
            let doc3 = {
                ...doc0,
                author: "@timm.baaaaaaaaaaaaaaaaaaaaaaaaazbqjwtzcnr7zyef2hvpftw45clq",
                content: "Hello 3",
                timestamp: doc0.timestamp - 3, // make sure this one wins
                signature: "whatever3", // everything assumes different docs have different sigs
            };
            // third author, oldest
            let doc4 = {
                ...doc0,
                author: "@bobo.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxnr7zyef2hvpftw45clq",
                content: "Hello 4",
                timestamp: doc0.timestamp - 4, // make sure this one wins
                signature: "whatever4", // everything assumes different docs have different sigs
            };

            let docResult: Doc = await driver.upsert(doc0);
            assertEquals(
                docResult._localIndex,
                0,
                "upsert doc0, localIndex is now 0",
            );
            assertEquals(
                driver.getMaxLocalIndex(),
                docResult._localIndex,
                "driver.getMaxLocalIndex() matches doc._localIndex",
            );

            let docs = await driver.queryDocs({});
            assertEquals(docs.length, 1, "query returns 1 doc");
            assertEquals(docs[0]._localIndex, 0, "docs[0]._localIndex");
            assertEquals(docs[0].content, "Hello 0", "content is from doc0");

            //-----------------

            // overwrite same author, latest
            docResult = await driver.upsert(doc1);
            assertEquals(
                docResult._localIndex,
                1,
                "upsert doc1 from same author, localIndex is now 1",
            );
            assertEquals(
                driver.getMaxLocalIndex(),
                docResult._localIndex,
                "driver.getMaxLocalIndex() matches doc._localIndex",
            );

            docs = await driver.queryDocs({});
            assertEquals(docs.length, 1, "query returns 1 doc");
            assertEquals(docs[0]._localIndex, 1, "docs[0]._localIndex");
            assertEquals(docs[0].content, "Hello 1", "content is from doc1");

            //-----------------

            // add a second author, latest
            docResult = await driver.upsert(doc2);
            assertEquals(
                docResult._localIndex,
                2,
                "upsert doc2 from second author, localIndex is now 3",
            );
            assertEquals(
                driver.getMaxLocalIndex(),
                docResult._localIndex,
                "driver.getMaxLocalIndex() matches doc._localIndex",
            );

            let latestDocs = await driver.queryDocs({ historyMode: "latest" });
            assertEquals(latestDocs.length, 1, "there is 1 latest doc");
            assertEquals(
                latestDocs[0]._localIndex,
                2,
                "latestDocs[0]._localIndex",
            );
            assertEquals(
                latestDocs[0].content,
                "Hello 2",
                "content is from doc2",
            );

            let allDocs = await driver.queryDocs({ historyMode: "all" });
            assertEquals(allDocs.length, 2, "there are 2 overall docs");
            assertEquals(
                allDocs[0].content,
                "Hello 2",
                "latestDocs[0].content is 2 (it's the latest)",
            );
            assertEquals(
                allDocs[1].content,
                "Hello 1",
                "latestDocs[1].content is 1",
            );

            //-----------------

            // add a second author, older, overwriting the previous newer one from same author.
            // -- should not bounce, that's the job of IStorage
            docResult = await driver.upsert(doc3);
            assertEquals(
                docResult._localIndex,
                3,
                "upsert doc3 from second author (but older), localIndex is now 3",
            );
            assertEquals(
                driver.getMaxLocalIndex(),
                docResult._localIndex,
                "driver.getMaxLocalIndex() matches doc._localIndex",
            );

            // latest doc is now from author 1
            latestDocs = await driver.queryDocs({ historyMode: "latest" });
            assertEquals(latestDocs.length, 1, "there is 1 latest doc");
            assertEquals(
                latestDocs[0]._localIndex,
                1,
                "latestDocs[0]._localIndex",
            );
            assertEquals(
                latestDocs[0].content,
                "Hello 1",
                "content is from doc1",
            );

            allDocs = await driver.queryDocs({ historyMode: "all" });
            assertEquals(allDocs.length, 2, "there are 2 overall docs");
            assertEquals(
                allDocs[0].content,
                "Hello 1",
                "latestDocs[0].content is 1 (it's the latest)",
            );
            assertEquals(
                allDocs[1].content,
                "Hello 3",
                "latestDocs[1].content is 3",
            );

            //-----------------

            // add a third author, oldest
            docResult = await driver.upsert(doc4);
            assertEquals(
                docResult._localIndex,
                4,
                "upsert doc4 from new third author (but oldest), localIndex is now 5",
            );
            assertEquals(
                driver.getMaxLocalIndex(),
                docResult._localIndex,
                "driver.getMaxLocalIndex() matches doc._localIndex",
            );

            // latest doc is still from author 1
            latestDocs = await driver.queryDocs({ historyMode: "latest" });
            assertEquals(latestDocs.length, 1, "there is 1 latest doc");
            assertEquals(
                latestDocs[0]._localIndex,
                1,
                "latestDocs[0]._localIndex is 1",
            );
            assertEquals(
                latestDocs[0].content,
                "Hello 1",
                "content is from doc1",
            );

            allDocs = await driver.queryDocs({ historyMode: "all" });
            assertEquals(allDocs.length, 3, "there are 2 overall docs");
            assertEquals(
                allDocs[0].content,
                "Hello 1",
                "latestDocs[0].content is 1 (it's the latest)",
            );
            assertEquals(
                allDocs[1].content,
                "Hello 3",
                "latestDocs[1].content is 3",
            );
            assertEquals(
                allDocs[2].content,
                "Hello 4",
                "latestDocs[2].content is 4",
            );

            //-----------------
            // test querying

            type Vector = { query: Query; expectedContent: string[] };
            let vectors: Vector[] = [
                {
                    query: {
                        historyMode: "all",
                        orderBy: "localIndex ASC",
                    },
                    expectedContent: ["Hello 1", "Hello 3", "Hello 4"],
                },
                {
                    query: {
                        historyMode: "all",
                        orderBy: "localIndex ASC",
                        limit: 2,
                    },
                    expectedContent: ["Hello 1", "Hello 3"],
                },
                {
                    query: {
                        historyMode: "all",
                        orderBy: "localIndex ASC",
                        startAfter: { localIndex: 2 },
                    },
                    expectedContent: ["Hello 3", "Hello 4"],
                },
                {
                    query: {
                        historyMode: "all",
                        orderBy: "localIndex ASC",
                        startAfter: { path: "a" }, // invalid combo of orderBy and startAt
                    },
                    expectedContent: [],
                },
                {
                    query: {
                        historyMode: "all",
                        orderBy: "localIndex ASC",
                        startAfter: { localIndex: 2 },
                        limit: 1,
                    },
                    expectedContent: ["Hello 3"],
                },
                {
                    query: {
                        historyMode: "all",
                        orderBy: "localIndex DESC",
                    },
                    expectedContent: ["Hello 4", "Hello 3", "Hello 1"],
                },
                {
                    query: {
                        historyMode: "all",
                        orderBy: "path ASC",
                    },
                    // sort by timestamp when path is the same, as it is here
                    expectedContent: ["Hello 1", "Hello 3", "Hello 4"],
                },
                {
                    query: {
                        historyMode: "latest",
                    },
                    expectedContent: ["Hello 1"],
                },
                {
                    query: {},
                    expectedContent: ["Hello 1"],
                },
                {
                    query: { limit: 0 },
                    expectedContent: [],
                },
                {
                    query: {
                        historyMode: "all",
                        orderBy: "path ASC",
                        filter: { author: doc0.author },
                    },
                    expectedContent: ["Hello 1"],
                },
            ];

            for (let { query, expectedContent } of vectors) {
                let qr = await driver.queryDocs(query);
                let actualContent = qr.map((doc) => doc.content);
                assertEquals(
                    actualContent,
                    expectedContent,
                    `query: ${J(query)}`,
                );
            }

            await driver.close(true);
            assertEquals(
                initialCryptoDriver,
                GlobalCryptoDriver,
                `GlobalCryptoDriver has not changed unexpectedly.  started as ${
                    (initialCryptoDriver as any).name
                }, ended as ${(GlobalCryptoDriver as any).name}`,
            );
        },
    );
}

for (let scenario of testScenarios) {
    runStorageDriverTests(scenario);
}
