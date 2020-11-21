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
    IStorageAsync,
} from '../util/types';
import {
    generateAuthorKeypair,
    sha256base32,
} from '../crypto/crypto';
import { ValidatorEs4 } from '../validator/es4';

import {
    IStorage3,
    IStorage3Async,
} from '../storage3/types3';
import {
    Query3,
    Query3ForForget,
    sortPathAscAuthorAsc,
} from '../storage3/query3';
import {
    Storage3Memory
} from '../storage3/storage3Memory';
import {
    localPush,
    localSync,
} from '../storage3/sync3local';
import {
    Fingerprint,
    incrementalSync,
} from '../storage3/sync3channels';
import { Storage3ToAsync } from '../storage3/storage3toasync';

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
    makeStorage: (workspace : string) => IStorage3 | IStorage3Async,
    description: string,
}
let scenarios : Scenario[] = [
    //{
    //    makeStorage: (workspace : string) : IStorage3 => {
    //        let storage = new Storage3Memory(VALIDATORS, workspace);
    //        storage._now = now;
    //        return storage;
    //    },
    //    description: "Storage3Memory",
    //},
    {
        makeStorage: (workspace : string) : IStorage3Async => {
            let storage = new Storage3ToAsync(new Storage3Memory(VALIDATORS, workspace), 50);
            storage._now = now;
            return storage;
        },
        description: "Async'd Storage3Memory",
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

        let inputDocs: Record<string, Document> = {
            d0: makeDoc({...base, keypair: keypair1, timestamp: now,   path: '/a', content: 'a1'}),
            d1: makeDoc({...base, keypair: keypair2, timestamp: now+1, path: '/a', content: 'a2'}),
            d2: makeDoc({...base, keypair: keypair1, timestamp: now+1, path: '/b', content: 'b1'}),
            d3: makeDoc({...base, keypair: keypair2, timestamp: now,   path: '/b', content: 'b2'}),
            d4: makeDoc({...base, keypair: keypair1, timestamp: now,   path: '/c', content: 'c1'}),
        };
        for (let doc of Object.values(inputDocs)) {
            await storage1.ingestDocument(doc, '');
        }

        let syncResults = await incrementalSync(storage1, storage2);
        console.log(`syncResults: ${JSON.stringify(syncResults)}`);

    });
}