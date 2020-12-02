import t = require('tap');
//t.runOnly = true;

import {
    AuthorKeypair,
    DocToSet,
    Document,
    FormatName,
    IValidator,
    Path,
    ValidationError,
    WorkspaceAddress,
    WriteResult,
    isErr,
    notErr,
} from '../../src/util/types';
import {
    generateAuthorKeypair,
    sha256base32,
} from '../../src/crypto/crypto';
import { ValidatorEs4 } from '../../src/validator/es4';

import {
    IStorage3,
    WriteEvent3,
} from '../../src/storage3/types3';
import {
    Query3,
    Query3ForForget,
    sortPathAscAuthorAsc,
} from '../../src/storage3/query3';
import {
    Storage3Memory
} from '../../src/storage3/storage3Memory';
import {
    localPush,
    localSync,
} from '../../src/storage3/sync3local';
import {
    Fingerprint,
    docToFingerprintIterator,
    fingerprintIteratorZipper,
    localQueryIterator,
    zipperToAction,
    lookupFingerprint,
    PushBuffer,
} from './sync3incremental';
import { uniq, sorted } from '../../src/util/helpers';
import { Storage3Sqlite } from '../../src/storage3/storage3Sqlite';
import { logTest } from '../../src/util/log';

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
    makeStorage: (workspace : string) => IStorage3,
    description: string,
}
let scenarios : Scenario[] = [
    {
        makeStorage: (workspace : string) : IStorage3 => {
            let storage = new Storage3Memory(VALIDATORS, workspace);
            storage._now = now;
            return storage;
        },
        description: 'Storage3Memory',
    },
    //{
    //    makeStorage: (workspace : string) : IStorage3 => {
    //        let storage = new Storage3Sqlite(VALIDATORS, workspace, ':memory:');
    //        storage._now = now;
    //        return storage;
    //    },
    //    description: 'Storage3Sqlite',
    //},
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

    t.test(scenario.description + ': continueAfter', async (t: any) => {
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
        Object.values(inputDocs).forEach(d => storage1._upsertDocument(d));

        localPush(storage1, storage2);
        let err1 = storage1.set(keypair1, { format: 'es.4', timestamp: now+3, path: '/b', content: 'b3b' });
        t.same(err1, WriteResult.Accepted, 'set1');
        let err2 = storage2.set(keypair1, { format: 'es.4', timestamp: now+3, path: '/c', content: 'c1b' });
        t.same(err2, WriteResult.Accepted, 'set2');

        let q1: Query3 = { history: 'all',  };
        let q2: Query3 = { history: 'all', author: author1  };
        let fing1 = docToFingerprintIterator(localQueryIterator(storage1, q1));
        let fing2 = docToFingerprintIterator(localQueryIterator(storage2, q2));
        let zip = fingerprintIteratorZipper(fing1, fing2);
        let zipActions = zipperToAction(zip);

        let summary = (f: Fingerprint | undefined): string | undefined =>
            f === undefined ? undefined : `${f[0]}--${f[1].split('.')[0]}`;

        let pushBufferTo2 = new PushBuffer(storage2);
        for await (let { action, f1, f2 } of zipActions) {
            if (action === 'nop-equal') {
                /* do nothing */
            }
            else if (action === 'push-missing' || action === 'push-newer') {
                console.log(`push ${summary(f1)}  storage1 --> storage2`);
                let doc = lookupFingerprint(storage1, f1 as Fingerprint);
                if (doc !== undefined) {
                    pushBufferTo2.push(doc);
                }
            }
            else if (action === 'pull-missing' || action === 'pull-newer') {
                console.log(`pull ${summary(f2)}  storage1 <-- storage2`);
                // TODO
            }
            else {
                throw new Error('oops'); // should never happen
            }
        }

        t.end();
    });
}