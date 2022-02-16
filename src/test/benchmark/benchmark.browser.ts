//================================================================================
// prepare for test scenarios

import { Crypto } from "../crypto/crypto";
import { CryptoDriverChloride, waitUntilChlorideIsReady } from "../crypto/crypto-driver-chloride";
import { CryptoDriverNode } from "../crypto/crypto-driver-node";
import { CryptoDriverTweetnacl } from "../crypto/crypto-driver-tweetnacl";
import { ICrypto, ICryptoDriver } from "../crypto/crypto-types";
import { FormatValidatorEs4 } from "../format-validators/format-validator-es4";
import { IFormatValidator } from "../format-validators/format-validator-types";
import { StorageAsync } from "../storage/storage-async";
import { StorageDriverAsyncMemory } from "../storage/storage-driver-async-memory";
import { IStorageAsync, IStorageDriverAsync } from "../storage/storage-types";
import { ClassThatImplements } from "../storage/util-types";
import { AuthorKeypair, FormatName, WorkspaceAddress } from "../util/doc-types";
import { isErr, notErr } from "../util/errors";

//================================================================================

let log = console.log;
function randInt(lo: number, hi: number) {
    return Math.floor(Math.random() * (hi - lo) + lo);
}

let pushLocal = async (
    storageFrom: IStorageAsync,
    storageTo: IStorageAsync,
): Promise<void> => {
    let docs = await storageFrom.getAllDocs();
    for (let doc of docs) {
        await storageTo.ingest(doc);
    }
};
let syncLocal = async (
    storage1: IStorageAsync,
    storage2: IStorageAsync,
): Promise<void> => {
    await pushLocal(storage1, storage2);
    await pushLocal(storage2, storage1);
};

//================================================================================

function makeParts({ cryptoDriver, storageDriverClass }: PartsInput): Parts {
    let description = `${(cryptoDriver as any).name} & ${(storageDriverClass as any).name}`;
    let crypto = new Crypto(cryptoDriver);
    let validator = new FormatValidatorEs4(crypto);
    function makeStorage(workspace: WorkspaceAddress): IStorageAsync {
        let storageDriver = new storageDriverClass(workspace);
        return new StorageAsync(workspace, validator, storageDriver);
    }
    return {
        description,
        cryptoDriver,
        crypto,
        validator,
        makeStorage,
    };
}

function makeDemoAuthors(crypto: Crypto) {
    let keypair1 = crypto.generateAuthorKeypair("test") as AuthorKeypair;
    let keypair2 = crypto.generateAuthorKeypair("twoo") as AuthorKeypair;
    let keypair3 = crypto.generateAuthorKeypair("thre") as AuthorKeypair;
    let keypair4 = crypto.generateAuthorKeypair("four") as AuthorKeypair;
    if (isErr(keypair1)) throw "oops";
    if (isErr(keypair2)) throw "oops";
    if (isErr(keypair3)) throw "oops";
    if (isErr(keypair4)) throw "oops";
    let author1 = keypair1.address;
    let author2 = keypair2.address;
    let author3 = keypair3.address;
    let author4 = keypair4.address;
    return {
        keypair1,
        keypair2,
        keypair3,
        keypair4,
        author1,
        author2,
        author3,
        author4,
    };
}

let now = 1500000000000000;
let SEC = 1000000;
let MIN = SEC * 60;
let HOUR = MIN * 60;
let DAY = HOUR * 24;

interface Scenario {
    partsInput: PartsInput;
}
let scenarios: Scenario[] = [
    {
        partsInput: {
            cryptoDriver: CryptoDriverTweetnacl,
            storageDriverClass: StorageDriverAsyncMemory,
        },
    },
    {
        partsInput: {
            cryptoDriver: CryptoDriverChloride,
            storageDriverClass: StorageDriverAsyncMemory,
        },
    },
    //{
    //    partsInput: {
    //        cryptoDriver: CryptoDriverNode,
    //        storageDriverClass: StorageDriverAsyncMemory,
    //    },
    //},
];

//================================================================================

class Runner {
    data: Record<string, Record<string, number | null>> = {}; // scenario --> testName --> ms per iter
    scenario: string = "";
    constructor() {
    }
    setScenario(scenario: string) {
        log(`${scenario}`);
        this.scenario = scenario;
    }
    _finishRun(testName: string, ms: number | null) {
        if (this.data[this.scenario] === undefined) {
            this.data[this.scenario] = {};
        }
        this.data[this.scenario][testName] = ms;
    }
    async runOnce(
        testName: string,
        opts: { actualIters?: number },
        fn: () => void | Promise<void>,
    ) {
        log(`    ${testName}`);
        let start = Date.now();
        let prom = fn();
        if (prom instanceof Promise) {
            await prom;
        }
        let end = Date.now();
        let ms = (end - start) / (opts.actualIters || 1);
        this._finishRun(testName, ms);
    }
    async runMany(
        testName: string,
        opts: { minDuration?: number },
        fn: () => void | Promise<void>,
    ) {
        log(`    ${testName}`);
        let start = Date.now();
        let ii = 1;
        let minDuration = opts.minDuration || 2000;
        let minIters = 3;
        while (true) {
            let prom = fn();
            if (prom instanceof Promise) {
                await prom;
            }
            now = Date.now();
            if (ii >= minIters && now - start > minDuration) break;
            ii++;
        }
        let end = Date.now();
        let ms = (end - start) / ii;
        this._finishRun(testName, ms);
    }
    note(testName: string) {
        log(`    ${testName}`);
        this._finishRun(testName + "|" + Math.random(), null);
    }
    report() {
        let report: string[] = [];
        for (let scenario of Object.keys(this.data)) {
            report.push(`${scenario}`);
            for (let [testName, ms] of Object.entries(this.data[scenario])) {
                if (ms === null) {
                    report.push(
                        `    ${"".padStart(8, " ")} ${testName.split("|")[0]}`,
                    );
                } else {
                    let opsPerSec = 1000 / ms;
                    //report.push(`    ${testName}: ${Math.floor(ms*100)/100} ms = ${Math.floor(opsPerSec*100)/100} ops / sec`);
                    report.push(
                        `    ${
                            ("" + Math.round(opsPerSec)).padStart(8, " ")
                        } ops / sec: ${testName}`,
                    );
                }
            }
            report.push("");
        }
        return report.join("\n");
    }
}

let gc = global.gc || (() => {});

let main = async () => {
    if (CryptoDriverChloride !== undefined) {
        await waitUntilChlorideIsReady();
    }

    let runner = new Runner();
    for (let scenario of scenarios) {
        let parts = makeParts(scenario.partsInput);
        let authors = makeDemoAuthors(parts.crypto);
        let WORKSPACE = "+gardening.pals";

        runner.setScenario(parts.description);

        //==================================================
        // setup
        let storageAdd = parts.makeStorage(WORKSPACE);
        gc();

        for (let n of [100]) { // , 101, 102, 103, 1000, 1001, 10000]) {
            await runner.runOnce(`storage: add ${n} docs (each)`, {
                actualIters: n,
            }, async () => {
                for (let ii = 0; ii < n; ii++) {
                    await storageAdd.set(authors.keypair1, {
                        format: "es.4",
                        workspace: WORKSPACE,
                        path: "/test/" + ii,
                        content: "hello" + ii,
                    });
                }
            });
            gc();

            let storageSyncToMe = parts.makeStorage(WORKSPACE);
            await runner.runOnce(
                `storage: sync ${n} docs to empty storage (each)`,
                { actualIters: n },
                async () => {
                    await syncLocal(storageAdd, storageSyncToMe);
                },
            );
            gc();

            await runner.runOnce(
                `storage: sync ${n} docs to full storage (each)`,
                { actualIters: n },
                async () => {
                    await syncLocal(storageAdd, storageSyncToMe);
                },
            );

            runner.note("");

            storageSyncToMe.close();
            storageSyncToMe = null as any;
            gc();
        }
        // teardown
        storageAdd.close();
        storageAdd = null as any;
        gc();

        /*
        //==================================================
        // setup
        let nKeys = 1000;
        let keypairs = [keypair1, keypair2];
        let storage10k = scenario.makeParts(WORKSPACE);
        for (let ii = 0; ii < nKeys; ii++) {
            for (let keypair of keypairs) {
                storage10k.set(keypair1, {
                    format: 'es.4',
                    path: '/test/' + ii,
                    content: keypair.address + '-' + ii,
                });
            }
        }
        for (let ii = 0; ii < 10; ii++) {
            storage10k.set(keypair4, {
                format: 'es.4',
                path: '/test/' + ii,
                content: 'hello-4-' + ii,
            });
        }
        gc();

        runner.runMany(`getDocument from ${nKeys} paths x ${keypairs.length} authors`, {minDuration: 1234}, () => {
            storage10k.getDocument(`/test/${randInt(0, nKeys)}`);
        });
        gc();
        runner.note('');

        runner.runMany(`docs(path) with ${nKeys} paths x ${keypairs.length} authors`, {minDuration: 1234}, () => {
            storage10k.documents({ path: '/test/123' });
        });
        gc();
        runner.runMany(`paths(path) with ${nKeys} paths x ${keypairs.length} authors`, {minDuration: 1234}, () => {
            storage10k.paths({ path: '/test/123' });
        });
        gc();
        runner.runMany(`contents(path) with ${nKeys} paths x ${keypairs.length} authors`, {minDuration: 1234}, () => {
            storage10k.contents({ path: '/test/123' });
        });
        gc();
        runner.note('');

        runner.runMany(`docs(all) with ${nKeys} paths x ${keypairs.length} authors`, {minDuration: 1234}, () => {
            storage10k.documents();
        });
        gc();
        runner.runMany(`paths(all) with ${nKeys} paths x ${keypairs.length} authors`, {minDuration: 1234}, () => {
            storage10k.paths();
        });
        gc();
        runner.runMany(`contents(all) with ${nKeys} paths x ${keypairs.length} authors`, {minDuration: 1234}, () => {
            storage10k.contents();
        });
        gc();
        runner.note('');

        runner.runMany(`docs(limit 10) with ${nKeys} paths x ${keypairs.length} authors`, {minDuration: 1234}, () => {
            storage10k.documents({ limit: 10 });
        });
        gc();
        runner.runMany(`paths(limit 10) with ${nKeys} paths x ${keypairs.length} authors`, {minDuration: 1234}, () => {
            storage10k.paths({ limit: 10 });
        });
        gc();
        runner.runMany(`contents(limit 10) with ${nKeys} paths x ${keypairs.length} authors`, {minDuration: 1234}, () => {
            storage10k.contents({ limit: 10 });
        });
        gc();
        runner.note('');

        runner.runMany(`docs: pathStartsWith get 10% of ${nKeys} paths x ${keypairs.length} authors`, {minDuration: 1234}, () => {
            storage10k.documents({ pathStartsWith: `/test/${randInt(0, 9)}` });
        });
        gc();
        runner.runMany(`docs: pathStartsWith get 10% of ${nKeys} paths x ${keypairs.length} authors, limit 10`, {minDuration: 1234}, () => {
            storage10k.documents({ pathStartsWith: `/test/${randInt(0, 9)}`, limit: 10 });
        });
        gc();
        runner.runMany(`docs: pathStartsWith get 1% of ${nKeys} paths x ${keypairs.length} authors`, {minDuration: 1234}, () => {
            storage10k.documents({ pathStartsWith: `/test/${randInt(10, 99)}` });
        });
        gc();
        runner.note('');

        runner.runMany(`docs: pathEndsWith get 10% of ${nKeys} paths x ${keypairs.length} authors`, {minDuration: 1234}, () => {
            storage10k.documents({ pathEndsWith: `${randInt(0, 9)}` });
        });
        gc();
        runner.runMany(`docs: pathEndsWith get 10% of ${nKeys} paths x ${keypairs.length} authors, limit 10`, {minDuration: 1234}, () => {
            storage10k.documents({ pathEndsWith: `${randInt(0, 9)}`, limit: 10 });
        });
        gc();
        runner.runMany(`docs: pathEndsWith get 1% of ${nKeys} paths x ${keypairs.length} authors`, {minDuration: 1234}, () => {
            storage10k.documents({ pathEndsWith: `${randInt(10, 99)}` });
        });
        gc();
        runner.note('');

        runner.runMany(`docs: pathStartsWith 10% AND pathEndsWith 10% combined, equals 1% of ${nKeys} paths x ${keypairs.length} authors`, {minDuration: 1234}, () => {
            storage10k.documents({ pathStartsWith: `/test/${randInt(0, 9)}`, pathEndsWith: `${randInt(0, 9)}` });
        });
        gc();
        runner.runMany(`docs: pathStartsWith 10% AND pathEndsWith 10% combined, equals 1% of ${nKeys} paths x ${keypairs.length} authors, limit 2`, {minDuration: 1234}, () => {
            storage10k.documents({ pathStartsWith: `/test/${randInt(0, 9)}`, pathEndsWith: `${randInt(0, 9)}`, limit: 2 });
        });
        gc();
        runner.note('');

        runner.runMany(`docs: author matching 1/${keypairs.length} out of ${nKeys} paths x ${keypairs.length} authors`, {minDuration: 1234}, () => {
            storage10k.documents({ author: author1 });
        });
        gc();

        runner.runMany(`docs: author matching 10 docs out of ${nKeys} paths x ${keypairs.length} authors`, {minDuration: 1234}, () => {
            storage10k.documents({ author: author4 });
        });
        gc();

        // teardown
        storage10k.close();
        storage10k = null as any;
        gc();
        */
    }

    log();
    log();
    log(runner.report());
};
log(new Date());
main();
