import t = require('tap');
//t.runOnly = true;

import {
    AuthorKeypair,
    DocToSet,
    Document,
    FormatName,
    IValidator,
    Path,
    WorkspaceAddress,
    WriteResult,
    isErr,
} from '../util/types';
import {
    generateAuthorKeypair,
    sha256base32,
} from '../crypto/crypto';
import { ValidatorEs4 } from '../validator/es4';

import {
    IStorage,
    IStorageAsync,
} from '../storage/storageTypes';
import {
    Query,
    QueryForForget,
    sortPathAscAuthorAsc,
} from '../storage/query';
import {
    StorageMemory
} from '../storage/storageMemory';
import {
    pushLocal,
    syncLocal,
} from '../sync/syncLocal';
import {
    Fingerprint,
    incrementalSync,
} from '../sync/syncWithChannels';
import { StorageToAsync } from '../storage/storageToAsync';

//================================================================================
// prepare for test scenarios

let WORKSPACE = '+gardenclub.xxxxxxxxxxxxxxxxxxxx';
let WORKSPACE2 = '+another.xxxxxxxxxxxxxxxxxxxx';

let VALIDATORS : IValidator[] = [ValidatorEs4];
let FORMAT : FormatName = VALIDATORS[0].format;

// tests assume these are in alphabetical order by author shortname
let keypair1 = generateAuthorKeypair('aut1') as AuthorKeypair;
let keypair2 = generateAuthorKeypair('aut2') as AuthorKeypair;
let keypair3 = generateAuthorKeypair('aut3') as AuthorKeypair;
let keypair4 = generateAuthorKeypair('aut4') as AuthorKeypair;
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

let SNOWMAN = '☃';  // \u2603  [0xe2, 0x98, 0x83] -- 3 bytes

interface Scenario {
    makeStorage: (workspace : string) => IStorage | IStorageAsync,
    description: string,
}
let scenarios : Scenario[] = [
    //{
    //    makeStorage: (workspace : string) : IStorage => {
    //        let storage = new StorageMemory(VALIDATORS, workspace);
    //        storage._now = now;
    //        return storage;
    //    },
    //    description: "StorageMemory",
    //},
    {
        makeStorage: (workspace : string) : IStorageAsync => {
            let storage = new StorageToAsync(new StorageMemory(VALIDATORS, workspace), 50);
            storage._now = now;
            return storage;
        },
        description: "Async'd StorageMemory",
    },
];

type MakeDocOpts = {
        workspace: WorkspaceAddress,
        keypair: AuthorKeypair,
        path: Path,
        content: string,
        timestamp: number,
        deleteAfter?: number,
}
let makeDoc = (opts: MakeDocOpts): Document => {
    let docToSet: DocToSet = {
        format: FORMAT,
        path: opts.path,
        content: opts.content,
    }
    let doc: Document = {
        format: docToSet.format,
        workspace: opts.workspace,
        path: docToSet.path,
        contentHash: sha256base32(docToSet.content),
        content: docToSet.content,
        author: opts.keypair.address,
        timestamp: opts.timestamp,
        deleteAfter: opts.deleteAfter || null,
        signature: '',
    }
    let validator = VALIDATORS[0];
    let signedDoc = validator.signDocument(opts.keypair, doc);
    if (isErr(signedDoc)) { throw signedDoc; }
    return signedDoc;
}

//================================================================================

for (let scenario of scenarios) {
    t.test(`==== starting test of ==== ${scenario.description}`, (t: any) => {
        t.end();
    });

    t.test(scenario.description + ': incrementalSync just pushing', async (t: any) => {
        let storage1 = scenario.makeStorage(WORKSPACE);
        let storage2 = scenario.makeStorage(WORKSPACE);

        let base = { workspace: WORKSPACE };

        let docs: Record<string, Document> = {
            d0: makeDoc({...base, keypair: keypair1, timestamp: now,   path: '/a', content: 'a1'}),
            d1: makeDoc({...base, keypair: keypair2, timestamp: now+1, path: '/a', content: 'a2'}),
            d2: makeDoc({...base, keypair: keypair1, timestamp: now+1, path: '/b', content: 'b1'}),
            d3: makeDoc({...base, keypair: keypair2, timestamp: now,   path: '/b', content: 'b2'}),
            d4: makeDoc({...base, keypair: keypair1, timestamp: now,   path: '/c', content: 'c1'}),
            d4b: makeDoc({...base, keypair: keypair1, timestamp: now+1, path: '/c', content: 'c2'}),
        };
        for (let doc of [docs.d0, docs.d1, docs.d2,          docs.d4]) {
            await storage1.ingestDocument(doc, '');
        }
        for (let doc of [                  docs.d2, docs.d3, docs.d4b]) {
            await storage2.ingestDocument(doc, '');
        }

        let syncResults = await incrementalSync(storage1, storage2);
        console.log(`syncResults: ${JSON.stringify(syncResults)}`);

        t.same(syncResults, { numPushed: 2, numPulled: 2 }, 'syncResults is correct');

        t.same(await storage1.getContent('/c'), 'c2', 'newer doc went to storage1');
        t.same(await storage2.getContent('/c'), 'c2', 'newer doc stayed on storage2');

        t.same(await storage1.contents({ history: 'all' }), 'a1 a2 b1 b2 c2'.split(' '), 'storage1 has expected docs');
        t.same(await storage2.contents({ history: 'all' }), 'a1 a2 b1 b2 c2'.split(' '), 'storage2 has expected docs');

        await storage1.close();
        await storage2.close();
    });
}