import {
    AuthorKeypair,
    Document,
    FormatName,
    IStorage,
    IValidator,
    SyncOpts,
    WriteResult,
    isErr,
    notErr,
    WriteEvent,
    ValidationError,
} from '../util/types';
import {
    generateAuthorKeypair,
    sha256base32,
} from '../crypto/crypto';
import { ValidatorEs4 } from '../validator/es4';
import { StorageMemory } from '../storage/memory';
import { StorageSqlite } from '../storage/sqlite';
import { isMainThread } from 'worker_threads';

//================================================================================
// prepare for test scenarios

let log = console.log;
let randInt = (lo: number, hi: number) =>
    Math.floor(Math.random() * (hi - lo) + lo);

let WORKSPACE = '+gardenclub.xxxxxxxxxxxxxxxxxxxx';
let WORKSPACE2 = '+another.xxxxxxxxxxxxxxxxxxxx';

let VALIDATORS : IValidator[] = [ValidatorEs4];
let FORMAT : FormatName = VALIDATORS[0].format;

let keypair1 = generateAuthorKeypair('test') as AuthorKeypair;
let keypair2 = generateAuthorKeypair('twoo') as AuthorKeypair;
let keypair3 = generateAuthorKeypair('thre') as AuthorKeypair;
let keypair4 = generateAuthorKeypair('four') as AuthorKeypair;
if (isErr(keypair1)) { throw "oops"; }
if (isErr(keypair2)) { throw "oops"; }
if (isErr(keypair3)) { throw "oops"; }
if (isErr(keypair4)) { throw "oops"; }
let author1 = keypair1.address;
let author2 = keypair2.address;
let author3 = keypair3.address;
let author4 = keypair4.address;
let now = 1500000000000000;

let SEC = 1000000;
let MIN = SEC * 60;
let HOUR = MIN * 60;
let DAY = HOUR * 24;

interface Scenario {
    makeStorage: (workspace : string) => IStorage,
    description: string,
}
let scenarios : Scenario[] = [
    {
        makeStorage: (workspace : string) : IStorage => new StorageMemory(VALIDATORS, workspace),
        description: 'StoreMemory',
    },
    {
        makeStorage: (workspace : string) : IStorage => new StorageSqlite({
            mode: 'create',
            workspace: workspace,
            validators: VALIDATORS,
            filename: ':memory:'
        }),
        description: "StoreSqlite(':memory:')",
    },
];

//================================================================================

class Runner {
    data: Record<string, Record<string, number | null>> = {};  // scenario --> testName --> ms per iter
    scenario: string = '';
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
    runOnce(testName: string, opts: {actualIters?: number}, fn: () => void) {
        log(`    ${testName}`);
        let start = Date.now();
        fn();
        let end = Date.now();
        let ms = (end - start) / (opts.actualIters || 1);
        this._finishRun(testName, ms);
    }
    runMany(testName: string, opts: {minDuration?: number}, fn: () => void) {
        log(`    ${testName}`);
        let start = Date.now();
        let ii = 1;
        let minDuration = opts.minDuration || 2000;
        let minIters = 3;
        while (true) {
            fn();
            now = Date.now();
            if (ii >= minIters && now - start > minDuration) { break; }
            ii++;
        }
        let end = Date.now();
        let ms = (end - start) / ii;
        this._finishRun(testName, ms);
    }
    note(testName: string) {
        log(`    ${testName}`);
        this._finishRun(testName + '|' + Math.random(), null);
    }
    report() {
        let report: string[] = [];
        for (let scenario of Object.keys(this.data)) {
            report.push(`${scenario}`);
            for (let [testName, ms] of Object.entries(this.data[scenario])) {
                if (ms === null) {
                    report.push(`    ${''.padStart(8, ' ')} ${testName.split('|')[0]}`);
                } else {
                    let opsPerSec = 1000 / ms;
                    //report.push(`    ${testName}: ${Math.floor(ms*100)/100} ms = ${Math.floor(opsPerSec*100)/100} ops / sec`);
                    report.push(`    ${('' + Math.round(opsPerSec)).padStart(8, ' ')} ops / sec: ${testName}`);
                }
            }
            report.push('');
        }
        return report.join('\n');
    }
}

let gc = global.gc || (() => {});

let main = () => {
    let runner = new Runner();
    for (let scenario of scenarios) {
        runner.setScenario(scenario.description);

        //==================================================
        // setup
        let storageAdd = scenario.makeStorage(WORKSPACE);
        gc();

        for (let n of [100, 101, 102, 103, 1000, 1001, 10000]) {
            runner.runOnce(`add ${n} docs (each)`, {actualIters: n}, () => {
                for (let ii = 0; ii < n; ii++) {
                    storageAdd.set(keypair1, {
                        format: 'es.4',
                        path: '/test/' + ii,
                        content: 'hello' + ii,
                    });
                }
            });
            gc();

            let storageSyncToMe = scenario.makeStorage(WORKSPACE);
            runner.runOnce(`sync ${n} docs to empty storage (each)`, {actualIters: n}, () => {
                storageAdd.sync(storageSyncToMe);
            });
            gc();

            runner.runOnce(`sync ${n} docs to full storage (each)`, {actualIters: n}, () => {
                storageAdd.sync(storageSyncToMe);
            });

            runner.note('');

            storageSyncToMe.close();
            storageSyncToMe = null as any;
            gc();
        }
        // teardown
        storageAdd.close();
        storageAdd = null as any;
        gc();

        //==================================================
        // setup
        let nKeys = 1000;
        let keypairs = [keypair1, keypair2];
        let storage10k = scenario.makeStorage(WORKSPACE);
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

        runner.runMany(`docs: pathPrefix get 10% of ${nKeys} paths x ${keypairs.length} authors`, {minDuration: 1234}, () => {
            storage10k.documents({ pathPrefix: `/test/${randInt(0, 9)}` });
        });
        gc();
        runner.runMany(`docs: pathPrefix get 10% of ${nKeys} paths x ${keypairs.length} authors, limit 10`, {minDuration: 1234}, () => {
            storage10k.documents({ pathPrefix: `/test/${randInt(0, 9)}`, limit: 10 });
        });
        gc();
        runner.runMany(`docs: pathPrefix get 1% of ${nKeys} paths x ${keypairs.length} authors`, {minDuration: 1234}, () => {
            storage10k.documents({ pathPrefix: `/test/${randInt(10, 99)}` });
        });
        gc();
        runner.note('');

        runner.runMany(`docs: pathSuffix get 10% of ${nKeys} paths x ${keypairs.length} authors`, {minDuration: 1234}, () => {
            storage10k.documents({ pathSuffix: `${randInt(0, 9)}` });
        });
        gc();
        runner.runMany(`docs: pathSuffix get 10% of ${nKeys} paths x ${keypairs.length} authors, limit 10`, {minDuration: 1234}, () => {
            storage10k.documents({ pathSuffix: `${randInt(0, 9)}`, limit: 10 });
        });
        gc();
        runner.runMany(`docs: pathSuffix get 1% of ${nKeys} paths x ${keypairs.length} authors`, {minDuration: 1234}, () => {
            storage10k.documents({ pathSuffix: `${randInt(10, 99)}` });
        });
        gc();
        runner.note('');

        runner.runMany(`docs: pathPrefix 10% AND pathSuffix 10% combined, equals 1% of ${nKeys} paths x ${keypairs.length} authors`, {minDuration: 1234}, () => {
            storage10k.documents({ pathPrefix: `/test/${randInt(0, 9)}`, pathSuffix: `${randInt(0, 9)}` });
        });
        gc();
        runner.runMany(`docs: pathPrefix 10% AND pathSuffix 10% combined, equals 1% of ${nKeys} paths x ${keypairs.length} authors, limit 2`, {minDuration: 1234}, () => {
            storage10k.documents({ pathPrefix: `/test/${randInt(0, 9)}`, pathSuffix: `${randInt(0, 9)}`, limit: 2 });
        });
        gc();
        runner.note('');

        runner.runMany(`docs: versionsByAuthor matching 1/${keypairs.length} out of ${nKeys} paths x ${keypairs.length} authors`, {minDuration: 1234}, () => {
            storage10k.documents({ versionsByAuthor: author1 });
        });
        gc();

        runner.runMany(`docs: versionsByAuthor matching 10 docs out of ${nKeys} paths x ${keypairs.length} authors`, {minDuration: 1234}, () => {
            storage10k.documents({ versionsByAuthor: author4 });
        });
        gc();

        // teardown
        storage10k.close();
        storage10k = null as any;
        gc();
    }

    log();
    log();
    log(runner.report());
}
log(new Date());
main();
