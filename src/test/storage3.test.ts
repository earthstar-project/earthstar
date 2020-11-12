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
} from '../util/types';
import {
    generateAuthorKeypair,
    sha256base32,
} from '../crypto/crypto';
import { ValidatorEs4 } from '../validator/es4';

import {
    IStorage3,
    WriteEvent3,
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
    storage3LocalPush,
    storage3LocalSync,
} from '../storage3/sync3';
import { uniq, sorted } from '../util/helpers';
import { Storage3Sqlite } from '../storage3/storage3Sqlite';

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
    {
        makeStorage: (workspace : string) : IStorage3 => {
            let storage = new Storage3Sqlite(VALIDATORS, workspace, ':memory:');
            storage._now = now;
            return storage;
        },
        description: 'Storage3Sqlite',
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
// constructor tests

t.test(`Storage3Memory: constructor`, (t: any) => {
    t.throws(() => new Storage3Memory([], WORKSPACE), 'throws when no validators are provided');
    t.throws(() => new Storage3Memory(VALIDATORS, 'bad-workspace-address'), 'throws when workspace address is invalid');
    t.end();
});

t.test(`Storage3Sqlite: constructor`, (t: any) => {
    t.throws(() => new Storage3Sqlite([], WORKSPACE, ':memory:'), 'throws when no validators are provided');
    t.throws(() => new Storage3Sqlite(VALIDATORS, 'bad-workspace-address', ':memory:'), 'throws when workspace address is invalid');
    t.end();
});


//================================================================================
// run the standard store tests on each scenario

for (let scenario of scenarios) {
    t.test(`==== starting test of ==== ${scenario.description}`, (t: any) => {
        t.end();
    });

    t.test(scenario.description + ': empty store', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);
        t.same(storage.authors(), [], 'no authors');
        t.same(storage.paths(), [], 'no paths');
        t.same(storage.documents(), [], 'no docs');
        t.same(storage.contents(), [], 'no contents');
        t.equal(storage.getDocument('xxx'), undefined, 'getDocument undefined');
        t.equal(storage.getDocument('xxx'), undefined, 'getContent undefined');
        t.end();
    });

    t.test(scenario.description + ': close', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);
        let storage2 = scenario.makeStorage(WORKSPACE);

        t.same(storage.isClosed(), false, 'starts off not closed');
        storage.close();
        t.same(storage.isClosed(), true, 'becomes closed');
        storage.close();
        t.same(storage.isClosed(), true, 'stays closed');

        storage2.destroyAndClose();
        t.same(storage2.isClosed(), true, 'destroyAndClose also closes');

        t.throws(() => storage.authors(), 'contents() throws when closed');
        t.throws(() => storage.paths(), 'paths() throws when closed');
        t.throws(() => storage.documents(), 'documents() throws when closed');
        t.throws(() => storage.contents(), 'contents() throws when closed');
        t.throws(() => storage.getContent('/a'), 'latestContent() throws when closed');
        t.throws(() => storage.getDocument('/a'), 'latestDocument() throws when closed');
        t.throws(() => storage.ingestDocument({} as any, ''), 'ingestDocument() throws when closed');
        t.throws(() => storage.set(keypair1, {} as any), 'set() throws when closed');
        t.throws(() => storage.forgetDocuments({ history: 'all' }), 'forgetDocuments() throws when closed');
        t.throws(() => storage.destroyAndClose(), 'destroyAndClose() throws when closed');
        t.end();
    });

    t.test(scenario.description + ': config', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);
        t.same(storage.getConfig('foo'), undefined, 'get of unknown key is undefined');

        storage.setConfig('foo', 'bar');
        t.same(storage.getConfig('foo'), 'bar', 'set and get roundtrip');

        storage.setConfig('foo', 'baz');
        t.same(storage.getConfig('foo'), 'baz', 'overwrite and get roundtrip');

        storage.setConfig('zzz', 'zzzzz');
        storage.deleteConfig('foo');
        t.same(storage.getConfig('foo'), undefined, 'delete, --> undefined');
        t.same(storage.getConfig('zzz'), 'zzzzz', 'but other keys remain');

        storage.deleteAllConfig();
        t.same(storage.getConfig('foo'), undefined, 'all are gone after clear');
        t.same(storage.getConfig('zzz'), undefined, 'all are gone after clear');

        storage.close();
        t.end();
    });

    t.test(scenario.description + ': upsert: always overwrite same-path-same-author', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        let base = { workspace: WORKSPACE };
        let inputDocs = [
            {...base, keypair: keypair1, timestamp: now, path: '/a', content: 'hello'},
            {...base, keypair: keypair1, timestamp: now + 1, path: '/a', content: 'hello'},
            {...base, keypair: keypair1, timestamp: now - 1, path: '/a', content: 'hello'},
        ].map(opts => makeDoc(opts));

        inputDocs.forEach(doc => storage._upsertDocument(doc));
        let outputDocs = storage.documents();

        t.same(outputDocs.length, 1, 'upsert should overwrite same-path-same-author');
        t.same(outputDocs[0], inputDocs[inputDocs.length-1], 'upsert always overwrites no matter the timestamp');

        storage.close();
        t.end();
    });

    t.test(scenario.description + ': upsert and authors: basic roundtrip', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        let base = { workspace: WORKSPACE };
        let inputDocs = [
            {...base, keypair: keypair1, timestamp: now    , path: '/a', content: 'hello'},
            {...base, keypair: keypair1, timestamp: now + 1, path: '/b', content: 'hello'},
            {...base, keypair: keypair2, timestamp: now    , path: '/a', content: 'hello'},
            {...base, keypair: keypair2, timestamp: now - 1, path: '/b', content: 'hello'},
        ].map(opts => makeDoc(opts));

        inputDocs.forEach(d => storage._upsertDocument(d));
        let outputDocs = storage.documents({ history: 'all' });

        t.same(outputDocs.length, inputDocs.length, 'upsert should not overwrite these test cases');
        let sortedInputs = [...inputDocs];
        sortedInputs.sort(sortPathAscAuthorAsc);
        t.same(outputDocs, sortedInputs, 'round-trip is deep-equal and sorted in expected order');

        t.ok(Object.isFrozen(inputDocs[0]), 'upsert inputs are frozen afterwards');

        let expectedAuthors = [author1, author2];
        expectedAuthors.sort();
        t.same(storage.authors(), expectedAuthors, 'authors are deduped and sorted');

        storage.close();
        t.end();
    });

    t.test(scenario.description + ': store ingestDocument rejects invalid docs', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        let doc1: Document = {
            format: FORMAT,
            workspace: WORKSPACE,
            path: '/k1',
            contentHash: sha256base32('v1'),
            content: 'v1',
            timestamp: now,
            deleteAfter: null,
            author: author1,
            signature: 'xxx',
        };
        let signedDoc = ValidatorEs4.signDocument(keypair1, doc1) as Document;
        t.ok(notErr(signedDoc), 'signature succeeded');
        t.same(storage.ingestDocument(signedDoc, ''), WriteResult.Accepted, "successful ingestion");
        t.equal(storage.getContent('/k1'), 'v1', "latestContent worked");

        t.ok(isErr(storage.ingestDocument(doc1, '')), "don't ingest: bad signature");
        t.ok(isErr(storage.ingestDocument({...signedDoc, format: 'xxx'}, '')), "don't ingest: unknown format");
        t.ok(isErr(storage.ingestDocument({...signedDoc, timestamp: now / 1000}, '')), "don't ingest: timestamp too small, probably in milliseconds");
        t.ok(isErr(storage.ingestDocument({...signedDoc, timestamp: now * 2}, '')), "don't ingest: timestamp in future");
        t.ok(isErr(storage.ingestDocument({...signedDoc, timestamp: Number.MAX_SAFE_INTEGER * 2}, '')), "don't ingest: timestamp way too large");
        t.ok(isErr(storage.ingestDocument({...signedDoc, workspace: 'xxx'}, '')), "don't ingest: changed workspace after signing");

        let signedDocDifferentWorkspace = ValidatorEs4.signDocument(keypair1, {...doc1, workspace: '+nope.nope'}) as Document;
        t.ok(notErr(signedDocDifferentWorkspace), 'signature succeeded');
        t.ok(isErr(storage.ingestDocument(signedDocDifferentWorkspace, '')), "don't ingest: mismatched workspace");

        t.ok(isErr(storage.set(keypair1, {
            format: 'xxx',
            path: '/k1',
            content: 'v1',
        })), 'set rejects unknown format');

        let writablePaths = [
            '/hello',
            '/~' + author1 + '/about',
            '/chat/~@ffff.xxxx~' + author1,
        ];
        for (let path of writablePaths) {
            let signedDoc2 = ValidatorEs4.signDocument(keypair1, {...doc1, path: path});
            if (isErr(signedDoc2)) {
                t.ok(false, 'signature failed: ' + signedDoc2);
            } else {
                t.same(storage.ingestDocument(signedDoc2, ''), WriteResult.Accepted, 'do ingest: writable path ' + path);
            }
        }
        let notWritablePaths = [
            '/~@ffff.bxxxx/about',
            '/~',
        ];
        let invalidPaths = [
            '',
            '/',
            'not-starting-with-slash',
            '/ending-with-slash/',
            '/has space',
            '/questionmark?',
        ];
        for (let path of notWritablePaths.concat(invalidPaths)) {
            let signedDoc2 = ValidatorEs4.signDocument(keypair1, {...doc1, path: path});
            if (isErr(signedDoc2)) {
                t.ok(false, 'signature failed: ' + signedDoc2);
            } else {
                t.ok(isErr(storage.ingestDocument(signedDoc2, '')), "don't ingest: non-writable or invalid path " + path);
            }
        }

        t.end();
    });

    t.test(scenario.description + ': forgetDocuments', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);
        let storage2 = scenario.makeStorage(WORKSPACE);

        let base = { workspace: WORKSPACE };

        let inputDocs: Record<string, Document> = {
            d0: makeDoc({...base, keypair: keypair1, timestamp: now    , path: '/a', content: ''}),
            d1: makeDoc({...base, keypair: keypair1, timestamp: now    , path: '/aa', content: '1'}),
            d2: makeDoc({...base, keypair: keypair1, timestamp: now    , path: '/aa/x', content: '22'}),
            d3: makeDoc({...base, keypair: keypair2, timestamp: now + 1, path: '/b', content: '333'}),  // this is the only obsolete doc
            d4: makeDoc({...base, keypair: keypair3, timestamp: now + 2, path: '/b', content: ''}),
            d5: makeDoc({...base, keypair: keypair2, timestamp: now    , path: '/cc/x', content: '55555'}),
        };
        Object.values(inputDocs).forEach(d => storage._upsertDocument(d));
        Object.values(inputDocs).forEach(d => storage2._upsertDocument(d));

        storage2.forgetDocuments({ history: 'all' });
        t.same(storage2.contents({ history: 'all' }), [], 'forget everything, no query options');

        storage.forgetDocuments({ history: 'all', limit: 0 } as any as Query3ForForget);
        t.same(storage.contents({ history: 'all' }), ['', '1', '22', '333', '', '55555'], 'forget with { limit: 0 } forgets nothing');

        storage.forgetDocuments({ contentLength: 3, history: 'all' });
        t.same(storage.contents({ history: 'all' }), ['', '1', '22', '', '55555'], 'forgot a non-head by contentLength');

        storage.forgetDocuments({ path: '/b', history: 'all' });
        t.same(storage.contents({ history: 'all' }), ['', '1', '22', '55555'], 'forgot by path');

        storage.forgetDocuments({ path: 'none-such', history: 'all' });
        t.same(storage.contents({ history: 'all' }), ['', '1', '22', '55555'], 'forgot nothing (no path matched)');

        storage.forgetDocuments({ pathPrefix: '/a', history: 'all' });
        t.same(storage.contents({ history: 'all' }), ['55555'], 'forgot by path prefix');

        storage.forgetDocuments({ pathPrefix: '/', history: 'all' });
        t.same(storage.contents({ history: 'all' }), [], 'forgot everything');

        t.throws(() => storage.forgetDocuments({ } as any), 'throws with no history mode');
        t.throws(() => storage.forgetDocuments({ history: 'latest' } as any), 'throws with history: latest');

        t.end();
    });

    t.test(scenario.description + ': unicode characters vs bytes', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        let base = { workspace: WORKSPACE };

        let inputDocs: Record<string, Document> = {
            d0: makeDoc({...base, keypair: keypair1, timestamp: now, path: '/0', content: ''}),
            d1: makeDoc({...base, keypair: keypair1, timestamp: now, path: '/1', content: '1'}),
            d2: makeDoc({...base, keypair: keypair1, timestamp: now, path: '/2', content: '22' }),
            d3: makeDoc({...base, keypair: keypair1, timestamp: now, path: '/3', content: SNOWMAN}),  // 1 unicode character, 3 bytes
            d4: makeDoc({...base, keypair: keypair2, timestamp: now, path: '/4', content: '4444'}),
        };
        Object.values(inputDocs).forEach(d => storage._upsertDocument(d));

        t.same(storage.paths({ contentLength: 0 }), ['/0'], 'paths contentLength 0');
        t.same(storage.paths({ contentLength: 1 }), ['/1'], 'paths contentLength 1 (should not have snowman in here, "/3")');
        t.same(storage.paths({ contentLength: 3 }), ['/3'], 'paths contentLength 3 (should have snowman here, "/3")');
        t.same(storage.paths({ contentLength: 77 }), [], 'paths contentLength 77 (no match)');

        t.same(storage.documents({ limitBytes: 0 }).map(d => d.path), [], 'limitBytes 0');
        t.same(storage.documents({ limitBytes: 1 }).map(d => d.path), ['/0', '/1'], 'limitBytes 1');
        t.same(storage.documents({ limitBytes: 2 }).map(d => d.path), ['/0', '/1'], 'limitBytes 2');
        t.same(storage.documents({ limitBytes: 3 }).map(d => d.path), ['/0', '/1', '/2'], 'limitBytes 3');
        t.same(storage.documents({ limitBytes: 4 }).map(d => d.path), ['/0', '/1', '/2'], 'limitBytes 4 no snowman yet...');
        t.same(storage.documents({ limitBytes: 5 }).map(d => d.path), ['/0', '/1', '/2'], 'limitBytes 5 no snowman yet...');
        t.same(storage.documents({ limitBytes: 6 }).map(d => d.path), ['/0', '/1', '/2', '/3'], 'limitBytes 6 includes snowman');
        t.same(storage.documents({ limitBytes: 9 }).map(d => d.path), ['/0', '/1', '/2', '/3'], 'limitBytes 9');
        t.same(storage.documents({ limitBytes: 10 }).map(d => d.path), ['/0', '/1', '/2', '/3', '/4'], 'limitBytes 10');

        t.end();
    });

    t.test(scenario.description + ': documentQuery and pathQuery', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        let base = { workspace: WORKSPACE };

        let inputDocs: Record<string, Document> = {
            d0: makeDoc({...base, keypair: keypair1, timestamp: now    , path: '/a', content: ''}),
            d1: makeDoc({...base, keypair: keypair1, timestamp: now    , path: '/aa', content: '1'}),
            d2: makeDoc({...base, keypair: keypair1, timestamp: now    , path: '/aa/x', content: '22'}),
            d3: makeDoc({...base, keypair: keypair2, timestamp: now + 1, path: '/b', content: '333'}),  // this is the only obsolete doc
            d4: makeDoc({...base, keypair: keypair3, timestamp: now + 2, path: '/b', content: ''}),
            d5: makeDoc({...base, keypair: keypair2, timestamp: now    , path: '/cc/x', content: '55555'}),
        };
        Object.values(inputDocs).forEach(d => storage._upsertDocument(d));

        let i = inputDocs;
        type TestCase = {
            query: Query3,
            matches: Document[],
            pathMatches?: Document[], // if path query gives a different result than doc query
            note?: string,
        }
        let testCases: TestCase[] = [
            // FOO
            // EMPTY QUERY
            {
                query: {},
                matches: [i.d0, i.d1, i.d2, i.d4, i.d5],  // no d3
            },
            // PATH
            {
                query: { path: '/aa' },
                matches: [i.d1],
            },
            {
                query: { path: '/b', history: 'all' },
                matches: [i.d3, i.d4],
                note: 'two authors at one path -- all',
            },
            {
                query: { path: '/b', history: 'latest' },
                matches: [i.d4],
                note: 'two authors at one path -- latest',
            },
            {
                query: { path: 'no such path' },
                matches: [],
            },
            // PATH PREFIX
            {
                query: { pathPrefix: '/aa' },
                matches: [i.d1, i.d2],
            },
            {
                query: { pathPrefix: 'no such prefix' },
                matches: [],
            },
            // TIMESTAMP
            {
                query: { timestamp: 0 },
                matches: [],
            },
            {
                query: { timestamp: 777 },
                matches: [],
            },
            {
                query: { timestamp: now + 1, history: 'latest' },
                matches: [],
            },
            {
                query: { timestamp: now + 1, history: 'all' },
                matches: [i.d3],
            },
            {
                query: { timestamp_gt: 777 },
                matches: [i.d0, i.d1, i.d2, i.d4, i.d5],
            },
            {
                query: { timestamp_gt: 0 },
                matches: [i.d0, i.d1, i.d2, i.d4, i.d5],
            },
            {
                query: { timestamp_gt: now },
                matches: [i.d4],
            },
            {
                query: { timestamp_lt: 0 },
                matches: [],
            },
            {
                query: { timestamp_lt: 777 },
                matches: [],
            },
            {
                query: { timestamp_lt: now + 1 },
                matches: [i.d0, i.d1, i.d2, i.d5],
            },
            {
                query: { timestamp_gt: 1, timestamp_lt: now + 1 },
                matches: [i.d0, i.d1, i.d2, i.d5],
            },
            {
                query: { timestamp_lt: 1, timestamp_gt: now + 1 },
                matches: [],
            },
            // AUTHOR
            {
                query: { author: author1 },
                matches: [i.d0, i.d1, i.d2],
            },
            {
                query: { author: author2, history: 'all' },
                matches: [i.d3, i.d5],  // this includes one obsolete doc and one head, from different paths
            },
            {
                query: { author: author2, history: 'latest' },
                matches: [i.d5],
            },
            {
                query: { author: author4 },
                matches: [],
            },
            // CONTENT SIZE
            {
                query: { contentLength: 0 },
                matches: [i.d0, i.d4],
            },
            {
                query: { contentLength: 2 },
                matches: [i.d2],
            },
            {
                query: { contentLength_gt: 0 },
                matches: [i.d1, i.d2, i.d5],
            },
            {
                query: { contentLength_gt: 0, history: 'all' },
                matches: [i.d1, i.d2, i.d3, i.d5],
            },
            {
                query: { contentLength_lt: 2 },
                matches: [i.d0, i.d1, i.d4],
            },
            // HISTORY MODE
            {
                query: { },  // default is 'latest'
                matches: [i.d0, i.d1, i.d2, i.d4, i.d5],  // not d3
            },
            {
                query: { history: 'latest' },
                matches: [i.d0, i.d1, i.d2, i.d4, i.d5],  // not d3
            },
            {
                query: { history: 'all' },
                matches: [i.d0, i.d1, i.d2, i.d3, i.d4, i.d5],  // include d3
            },
            // LIMIT
            {
                query: { limit: 0 },
                matches: [],
            },
            {
                query: { limit: 1 },
                matches: [i.d0],
            },
            {
                query: { limit: 4 },
                // when history is 'latest' (the default), and there are no other filters,
                // the number of heads === the number of distinct paths
                matches: [i.d0, i.d1, i.d2, i.d4],
                pathMatches: [i.d0, i.d1, i.d2, i.d4],
            },
            {
                query: { limit: 5, history: 'all' },
                // the first 5 documents (including history) only have 4 distinct paths between them.
                // so the first 5 distinct paths reach a little further than the first 5 docs.
                // (limit is applied after distinct-ifying paths)
                matches: [i.d0, i.d1, i.d2, i.d3, i.d4],
                pathMatches: [i.d0, i.d1, i.d2, i.d3, i.d5],
                note: 'limit should be applied after distinct paths',
            },
            {
                query: { limit: 999 },
                matches: [i.d0, i.d1, i.d2, i.d4, i.d5],
            },
            {
                query: { limit: 999, history: 'all' },
                matches: [i.d0, i.d1, i.d2, i.d3, i.d4, i.d5],
            },
            // LIMIT BYTES
            {
                query: { limitBytes: 0 },
                matches: [],  // don't even get the first '', stop as soon as possible
                // path queries ignore limitBytes
                pathMatches: [i.d0, i.d1, i.d2, i.d4, i.d5],
            },
            {
                query: { limitBytes: 1 },
                matches: [i.d0, i.d1],  // '' + '1' <= 1 byte
                pathMatches: [i.d0, i.d1, i.d2, i.d4, i.d5],
            },
            {
                query: { limitBytes: 2 },
                matches: [i.d0, i.d1],  // '' + '1' <= 1 byte
                pathMatches: [i.d0, i.d1, i.d2, i.d4, i.d5],
            },
            {
                query: { limitBytes: 3 },
                matches: [i.d0, i.d1, i.d2],  // '' + '1' + '22' <= 3 bytes, don't get the following ''
                pathMatches: [i.d0, i.d1, i.d2, i.d4, i.d5],
            },
        ];
        for (let testCase of testCases) {
            testCase.matches.sort(sortPathAscAuthorAsc);
        }

        // test documentQuery
        for (let { query, matches, note } of testCases) {
            note = (note || '') + ' ' + JSON.stringify(query);
            let actualMatches = storage.documents(query);
            if (matches.length !== actualMatches.length) {
                t.same(actualMatches.length, matches.length, `documentQuery: correct number of results: ${note}`);
            } else {
                t.same(actualMatches, matches, `documentQuery: all match: ${note}`);
            }
        }

        // test pathQuery
        for (let { query, matches, pathMatches, note } of testCases) {
            note = (note || '') + ' ' + JSON.stringify(query);
            if (pathMatches !== undefined) { matches = pathMatches; }
            let expectedPaths = sorted(uniq(matches.map(m => m.path)));
            let actualPaths = storage.paths(query);
            t.same(actualPaths, expectedPaths, `pathQuery: all match: ${note}`);
        }

        storage.close();
        t.end();
    });

    t.test(scenario.description + ': do not return expired docs', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        // a good doc
        let doc1 = makeDoc({workspace: WORKSPACE, keypair: keypair1, path: '/a', content: 'hello', timestamp: now });
        // a doc that will expire
        let doc2 = makeDoc({workspace: WORKSPACE, keypair: keypair1, path: '/a!', content: 'hello', timestamp: now, deleteAfter: now + 5 });

        storage._upsertDocument(doc1);
        storage._upsertDocument(doc2);

        t.same(storage.paths(), ['/a', '/a!'], 'paths: starting off with 2 docs');
        t.same(storage.documents().length, 2, 'documents: starting off with 2 docs');
        t.ok(storage.getDocument('/a!') !== undefined, 'getDocument: ephemeral doc still exists');

        // jump to the future
        storage._now = now + 100;

        t.same(storage.paths(), ['/a'] , 'paths: only 1 doc left after the other one expired');
        t.same(storage.documents().length, 1, 'documents: only 1 left');
        t.ok(storage.getDocument('/a!') === undefined, 'getDocument returns undefined on expired doc');

        t.end();
    });

    t.test(scenario.description + ': discardExpiredDocuments', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        // this should do nothing on an empty storage
        storage.discardExpiredDocuments();

        // a good doc
        let doc1 = makeDoc({workspace: WORKSPACE, keypair: keypair1, path: '/a', content: 'hello', timestamp: now });
        // a doc that will expire
        let doc2 = makeDoc({workspace: WORKSPACE, keypair: keypair1, path: '/a!', content: 'hello', timestamp: now, deleteAfter: now + 5 });

        storage._upsertDocument(doc1);
        storage._upsertDocument(doc2);

        t.same(storage.paths().length, 2, 'starting off with 2 docs');

        // remove expired docs as if we were in the future
        storage._now = now + 100;
        storage.discardExpiredDocuments();

        // back in the present, query and only find 1
        storage._now = now;
        t.same(storage.paths().length, 1, 'only 1 remains after expired doc was removed');

        storage.close();
        t.end();
    });

    t.test(scenario.description + ': deleteAfter', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        // an expired ephemeral doc can't be set because it's invalid
        t.ok(isErr(storage.set(keypair1, {
                format: FORMAT,
                path: '/path1!',
                content: 'aaa',
                timestamp: now - 60*MIN,
                deleteAfter: now - 45*MIN,
        })), 'set expired ephemeral document');
        t.equal(storage.getContent('/path1!'), undefined, 'temporary doc is not there');

        // a good doc.  make sure deleteAfter survives the roundtrip
        t.same(storage.set(keypair1, {
                format: FORMAT,
                path: '/ephemeral!',
                content: 'bbb',
                timestamp: now,
                deleteAfter: now + 3 * DAY,
        }), WriteResult.Accepted, 'set good ephemeral document');
        t.same(storage.set(keypair1, {
                format: FORMAT,
                path: '/regular',
                content: 'ccc',
                timestamp: now,
        }), WriteResult.Accepted, 'set good regular document');
        let ephDoc = storage.getDocument('/ephemeral!');
        let regDoc = storage.getDocument('/regular');

        if (ephDoc === undefined) {
            t.true(false, 'ephDoc was not set, or not retrieved');
        } else {
            t.true('deleteAfter' in (ephDoc as any), 'ephemeral doc has deleteAfter after roundtrip');
            t.equal(ephDoc?.deleteAfter, now + 3 * DAY, 'ephemeral doc deleteAfter value survived roundtrip');
        }
        if (regDoc === undefined) {
            t.true(false, 'regDoc was not set, or not retrieved');
        } else {
            t.equal(regDoc.deleteAfter, null, 'as expected, regular doc has deleteAfter: null');
        }

        // a doc that was valid when set, but expired while sitting in the database, then was read after being expired
        let setExpiringDoc = () => {
            t.same(storage.set(keypair1, {
                    format: FORMAT,
                    path: '/expire-in-place!',
                    content: 'ccc',
                    timestamp: now - 1,
                    deleteAfter: now + 5 * DAY,
            }), WriteResult.Accepted, 'set good ephemeral document');
        };

        if (false) {
            // optional behavior: delete expired docs when we encounter them.
            // it's sufficient to just ignore them, not delete them on the spot,
            // as long as they're eventually cleaned up.

            // set the doc, observe it in place.
            // set now ahead, try to get the doc, which should delete it.
            // rewind now again, and the doc should still be gone because it was deleted.
            setExpiringDoc();
            storage._now = now;
            t.notEqual(storage.getDocument('/expire-in-place!'), undefined, 'getDocument(): doc was there');
            storage._now = now + 8 * DAY;
            t.equal(   storage.getDocument('/expire-in-place!'), undefined, 'getDocument(): doc expired in place');
            storage._now = now;
            t.equal(   storage.getDocument('/expire-in-place!'), undefined, 'getDocument(): doc was deleted after expiring');

            setExpiringDoc();
            storage._now = now;
            t.equal(storage.getContent('/expire-in-place!'), 'ccc',     'getContent(): doc was there');
            storage._now = now + 8 * DAY;
            t.equal(storage.getContent('/expire-in-place!'), undefined, 'getContent(): doc expired in place');
            storage._now = now;
            t.equal(storage.getContent('/expire-in-place!'), undefined, 'getContent(): doc was deleted after expiring');

            setExpiringDoc();
            storage._now = now;
            t.same(storage.paths({pathPrefix: '/exp'}), ['/expire-in-place!'], 'paths(): doc was there');
            storage._now = now + 8 * DAY;
            t.same(storage.paths({pathPrefix: '/exp'}), [], 'paths(): doc expired in place');
            storage._now = now;
            t.same(storage.paths({pathPrefix: '/exp'}), [], 'paths(): doc was deleted after expiring');

            setExpiringDoc();
            storage._now = now;
            t.same(storage.documents({pathPrefix: '/exp'}).length, 1, 'documents(): doc was there');
            storage._now = now + 8 * DAY;
            t.same(storage.documents({pathPrefix: '/exp'}).length, 0, 'documents(): doc expired in place');
            storage._now = now;
            t.same(storage.documents({pathPrefix: '/exp'}).length, 0, 'documents(): doc was deleted after expiring');
        }

        // TODO for ephemeral doc tests:
        //
        // implement removal and result checking in sqlite and memory
        //
        // test includeHistory / isHead
        // test limit

        t.end();
    });


    t.test(scenario.description + ': basic one-author store', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        t.equal(storage.getContent('/path1'), undefined, 'nonexistant paths are undefined');
        t.equal(storage.getContent('/path2'), undefined, 'nonexistant paths are undefined');

        // set a decoy path to make sure the later tests return the correct path
        t.same(storage.set(keypair1, {format: FORMAT, path: '/decoy', content:'zzz', timestamp: now }), WriteResult.Accepted, 'set decoy path');

        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1.0', timestamp: now }), WriteResult.Accepted, 'set new path');
        t.equal(storage.getContent('/path1'), 'val1.0');

        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1.2', timestamp: now + 2 }), WriteResult.Accepted, 'overwrite path with newer time');
        t.equal(storage.getContent('/path1'), 'val1.2');

        // write with an old timestamp - this timestamp should be overridden to the existing timestamp + 1.
        // note that on ingest() the newer timestamp wins, but on set() we adjust the newly created timestamp
        // so it's always greater than the existing ones.
        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1.1', timestamp: now - 99 }), WriteResult.Ignored, 'do not supercede timestamp when providing one manually');
        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1.1' }), WriteResult.Accepted, 'automatically supercede previous timestamp');
        t.equal(storage.getContent('/path1'), 'val1.1', 'superceded newer existing content');
        t.equal(storage.getDocument('/path1')?.timestamp, now + 3, 'timestamp was superceded by 1 microsecond');

        // should be alphabetical
        t.same(storage.paths(), ['/decoy', '/path1'], 'paths() are correct');

        // order of contents should match order of paths
        t.same(storage.contents(), ['zzz', 'val1.1'], 'contents() are correct');

        t.same(storage.authors(), [author1], 'author');

        // returned document should have matching contentHash and content
        let doc = storage.getDocument('/path1');
        if (doc === undefined) { t.ok(false, 'this doc should not be undefined'); }
        else {
            t.notEqual(doc.content, null, 'content should not be null');
            t.equal(doc.contentHash, sha256base32(doc.content), 'doc.contentHash matches doc.content after roundtrip');
        }

        t.end();
    });

    t.test(scenario.description + ': path queries', (t: any) => {
        // TODO: test this with multiple docs per path
        let storage = scenario.makeStorage(WORKSPACE);
        let paths = '/zzz /aaa /dir /q /qq /qqq /dir/a /dir/b /dir/c'.split(' ');
        let ii = 0;
        for (let path of paths) {
            t.same(storage.set(keypair1, {format: FORMAT, path: path, content: 'true', timestamp: now + ii}), WriteResult.Accepted, 'set path: ' + path);
            ii += 1;
        }
        let sortedPaths = [...paths];
        sortedPaths.sort();
        let pathsFromStorage = storage.paths();
        t.same(paths.length, pathsFromStorage.length, 'same number of paths');
        t.same(sortedPaths, pathsFromStorage, 'paths are sorted');

        t.same(storage.paths({ path: '/q' }), ['/q'], 'query for specific path');
        t.same(storage.documents({ path: '/q' }).map(doc => doc.path), ['/q'], 'query for specific path (documents)');
        t.same(storage.paths({ path: '/nope' }), [], 'query for missing path');
        t.same(storage.documents({ path: '/nope' }), [], 'query for missing path (documents)');

        t.same(storage.paths({ pathPrefix: '/dir' }), ['/dir', '/dir/a', '/dir/b', '/dir/c'], 'pathPrefix');
        t.same(storage.paths({ pathPrefix: '/dir/' }), ['/dir/a', '/dir/b', '/dir/c'], 'pathPrefix');
        t.same(storage.paths({ pathPrefix: '/dir/', limit: 2 }), ['/dir/a', '/dir/b'], 'pathPrefix with limit');
        t.end();
    });

    t.test(scenario.description + ': contentIsEmpty queries', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        t.same(storage.set(keypair1, {format: FORMAT, path: '/full', content: 'full', timestamp: now}), WriteResult.Accepted, 'set /full to "full"');
        t.same(storage.set(keypair1, {format: FORMAT, path: '/empty', content: '', timestamp: now}), WriteResult.Accepted, 'set /empty to ""');
        t.same(storage.set(keypair1, {format: FORMAT, path: '/empty2', content: '', timestamp: now}), WriteResult.Accepted, 'set /empty2 to ""');

        t.same(storage.getDocument('/full')?.content, 'full', 'full getDocument.content = "full"');
        t.same(storage.getContent('/full'), 'full', 'full getContent = "full" ');
        t.same(storage.getDocument('/empty')?.content, '', 'empty getDocument.content = ""');
        t.same(storage.getContent('/empty'), '', 'empty getContent = ""');

        t.same(storage.documents().length, 3, 'documents() length = 3')
        t.same(storage.paths().length, 3, 'paths() length = 3')
        t.same(storage.contents().length, 3, 'contents() length = 3')

        t.same(storage.documents({ contentLength_gt: 0 }).length, 1, 'documents(contentLength_gt: 0) length = 1')
        t.same(storage.paths(    { contentLength_gt: 0 }).length, 1, 'paths(contentLength_gt: 0) length = 1')
        t.same(storage.contents( { contentLength_gt: 0 }).length, 1, 'contents(contentLength_gt: 0) length = 1')

        t.same(storage.documents({ contentLength: 0 }).length, 2, 'documents(contentLength: 0) length = 2')
        t.same(storage.paths(    { contentLength: 0 }).length, 2, 'paths(contentLength: 0) length = 2')
        t.same(storage.contents( { contentLength: 0 }).length, 2, 'contents(contentLength: 0) length = 2')

        // overwrite full with empty, and vice versa
        t.same(storage.set(keypair2, {format: FORMAT, path: '/full',  content: '',  timestamp: now + 2 }), WriteResult.Accepted, 'set /full to "" using author 2');
        t.same(storage.set(keypair2, {format: FORMAT, path: '/empty', content: 'e', timestamp: now + 2 }), WriteResult.Accepted, 'set /empty to "e" using author 2');

        t.same(storage.getDocument('/full')?.content, '', 'full getDocument.content = ""');
        t.same(storage.getContent('/full'), '', 'full getContent = "" ');
        t.same(storage.getDocument('/empty')?.content, 'e', 'empty getDocument.content = "e"');
        t.same(storage.getContent('/empty'), 'e', 'empty getContent = "e"');

        // combine path and contentLength queries
        // note there are now two docs for each path.

        // the head in /full has no content (we changed it, above)
        t.same(storage.documents({ history: 'latest', path: '/full'                    }).length, 1, 'documents({ isHead: true, path: /full,                   }) length = 1')
        t.same(storage.documents({ history: 'latest', path: '/full', contentLength_gt: 0 }).length, 0, 'documents({ isHead: true, path: /full, contentLength_gt: 0 }) length = 0')
        t.same(storage.documents({ history: 'latest', path: '/full', contentLength: 0    }).length, 1, 'documents({ isHead: true, path: /full, contentLength: 0    }) length = 1')

        // in /full there's two docs: one has content '' and one has 'full'
        t.same(storage.documents({ history: 'all',    path: '/full'                    }).length, 2, 'documents({               path: /full,                   }) length = 2')
        t.same(storage.documents({ history: 'all',    path: '/full', contentLength_gt: 0 }).length, 1, 'documents({               path: /full, contentLength_gt: 0 }) length = 1')
        t.same(storage.documents({ history: 'all',    path: '/full', contentLength: 0    }).length, 1, 'documents({               path: /full, contentLength: 0    }) length = 1')

        // the head in /empty has content 'e'
        t.same(storage.documents({ history: 'latest', path: '/empty'                    }).length, 1, 'documents({ isHead: true, path: /empty,                   }) length = 1')
        t.same(storage.documents({ history: 'latest', path: '/empty', contentLength_gt: 0 }).length, 1, 'documents({ isHead: true, path: /empty, contentLength_gt: 0 }) length = 1')
        t.same(storage.documents({ history: 'latest', path: '/empty', contentLength: 0    }).length, 0, 'documents({ isHead: true, path: /empty, contentLength: 0    }) length = 0')

        // in /empty there's two docs: one has content '' and one has 'full'
        t.same(storage.documents({ history: 'all',    path: '/empty'                    }).length, 2, 'documents({               path: /empty,                   }) length = 2')
        t.same(storage.documents({ history: 'all',    path: '/empty', contentLength_gt: 0 }).length, 1, 'documents({               path: /empty, contentLength_gt: 0 }) length = 1')
        t.same(storage.documents({ history: 'all',    path: '/empty', contentLength: 0    }).length, 1, 'documents({               path: /empty, contentLength: 0    }) length = 1')

        t.end();
    });

    t.test(scenario.description + ': limits on queries', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        // three authors
        t.same(storage.set(keypair1, {format: FORMAT, path: '/foo', content: 'foo', timestamp: now}), WriteResult.Accepted, 'set data');
        // set them out of order to make sure they sort correctly
        t.same(storage.set(keypair1, {format: FORMAT, path: '/pathA', content: 'content1', timestamp: now + 1}), WriteResult.Accepted, 'set data');
        t.same(storage.set(keypair3, {format: FORMAT, path: '/pathA', content: 'content3', timestamp: now + 3}), WriteResult.Accepted, 'set data');
        t.same(storage.set(keypair2, {format: FORMAT, path: '/pathA', content: 'content2', timestamp: now + 2}), WriteResult.Accepted, 'set data');

        // (authors are numbered in alphabetical order)
        t.same(storage.authors(), [author1, author2, author3], 'authors');

        // queries with limits
        // including all history

        t.same(storage.paths(   { history: 'all', limit: 1 }), ['/foo'], 'paths with history, limit 1');
        t.same(storage.contents({ history: 'all', limit: 1 }), ['foo'], 'contents with history, limit 1');

        t.same(storage.paths(   { history: 'all', limit: 2 }), ['/foo', '/pathA'], 'paths with history, limit 2');
        t.same(storage.contents({ history: 'all', limit: 2 }), ['foo', 'content1'], 'contents with history, limit 2');

        t.same(storage.paths(   { history: 'all', limit: 3 }), ['/foo', '/pathA'], 'paths with history, limit 3');
        t.same(storage.contents({ history: 'all', limit: 3 }), ['foo', 'content1', 'content2'], 'contents with history, limit 3');

        t.same(storage.paths(   { history: 'all' }), ['/foo', '/pathA'], 'paths with history, no limit');
        t.same(storage.contents({ history: 'all' }), ['foo', 'content1', 'content2', 'content3'], 'contents with history, no limit');
        
        // no history, just heads
        t.same(storage.paths(   { history: 'latest' }), ['/foo', '/pathA'], 'paths no history, no limit');
        t.same(storage.contents({ history: 'latest' }), ['foo', 'content3'], 'contents no history, no limit');

        t.same(storage.paths(   { history: 'latest', limit: 1 }), ['/foo'], 'paths no history, limit 1');
        t.same(storage.contents({ history: 'latest', limit: 1 }), ['foo'], 'contents no history, limit 1');

        t.end();
    });

    t.test(scenario.description + ': path and author queries', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        // two authors
        t.same(storage.set(keypair1, {format: FORMAT, path: '/pathA', content: 'content1.X', timestamp: now + 1}), WriteResult.Accepted, 'set data');
        t.same(storage.set(keypair2, {format: FORMAT, path: '/pathA', content: 'content2.Y', timestamp: now + 2}), WriteResult.Accepted, 'set data');
        t.same(storage.set(keypair1, {format: FORMAT, path: '/pathA', content: 'content1.Z', timestamp: now + 3}), WriteResult.Accepted, 'set data');

        t.same(storage.authors(), [author1, author2], 'authors');

        // path queries
        t.same(storage.paths(    { path: '/pathA', history: 'latest' }), ['/pathA'], 'paths with path query');
        t.same(storage.contents( { path: '/pathA', history: 'latest' }), ['content1.Z'], 'contents with path query');
        t.same(storage.documents({ path: '/pathA', history: 'latest' }).map(d => d.content), ['content1.Z'], 'documents with path query');

        t.same(storage.paths(    { path: '/pathA', history: 'all' }), ['/pathA'], 'paths with path query, history');
        t.same(storage.contents( { path: '/pathA', history: 'all' }), ['content1.Z', 'content2.Y'], 'contents with path query, history');
        t.same(storage.documents({ path: '/pathA', history: 'all' }).map(d => d.content), ['content1.Z', 'content2.Y'], 'documents with path query, history');

        // author
        t.same(storage.contents({  author: author1, history: 'latest' }), ['content1.Z'], 'contents author 1, no history');
        t.same(storage.contents({  author: author2, history: 'latest' }), [], 'contents author 2, no history');
        t.same(storage.documents({ author: author1, history: 'latest' }).length, 1, 'documents author 1, no history');
        t.same(storage.documents({ author: author2, history: 'latest' }).length, 0, 'documents author 2, no history');
        t.same(storage.paths({     author: author1, history: 'latest' }), ['/pathA'], 'paths author 1, no history');
        t.same(storage.paths({     author: author2, history: 'latest' }), [], 'paths author 2, no history');

        t.same(storage.contents({  author: author1, history: 'all' }), ['content1.Z'], 'contents author 1, history');
        t.same(storage.contents({  author: author2, history: 'all' }), ['content2.Y'], 'contents author 2, history');
        t.same(storage.documents({ author: author1, history: 'all' }).length, 1, 'documents author 1, history');
        t.same(storage.documents({ author: author2, history: 'all' }).length, 1, 'documents author 2, history');
        t.same(storage.paths({     author: author1, history: 'all' }), ['/pathA'], 'paths author 1, history');
        t.same(storage.paths({     author: author2, history: 'all' }), ['/pathA'], 'paths author 2, history');

        //// participatingAuthor
        //// TODO: this has been removed from the latest query options
        //t.same(storage.contents({ participatingAuthor: author1, history: 'all'  }), ['content1.Z', 'content2.Y'], 'participatingAuthor 1, with history');
        //t.same(storage.contents({ participatingAuthor: author1, history: 'latest' }), ['content1.Z'], 'participatingAuthor 1, no history');
        //t.same(storage.contents({ participatingAuthor: author2, history: 'all'  }), ['content1.Z', 'content2.Y'], 'participatingAuthor 2, with history');
        //t.same(storage.contents({ participatingAuthor: author2, history: 'latest' }), ['content1.Z'], 'participatingAuthor 2, no history');

        t.end();
    });

    t.test(scenario.description + ': multi-author writes', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

       // set decoy paths to make sure the later tests return the correct path
        t.same(storage.set(keypair1, {format: FORMAT, path: '/decoy2', content: 'zzz', timestamp: now}), WriteResult.Accepted, 'set decoy path 2');
        t.same(storage.set(keypair1, {format: FORMAT, path: '/decoy1', content: 'aaa', timestamp: now}), WriteResult.Accepted, 'set decoy path 1');

        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'one', timestamp: now}), WriteResult.Accepted, 'set new path');
        t.equal(storage.getContent('/path1'), 'one');

        // this will overwrite 'one' but the doc for 'one' will remain in history.
        // history will have 2 docs for this path.
        t.same(storage.set(keypair2, {format: FORMAT, path: '/path1', content: 'two', timestamp: now + 1}), WriteResult.Accepted, 'update from a second author');
        t.equal(storage.getContent('/path1'), 'two');

        // this will replace the old original doc 'one' from this author.
        // history will have 2 docs for this path.
        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'three', timestamp: now + 2}), WriteResult.Accepted, 'update from original author again');
        t.equal(storage.getContent('/path1'), 'three');

        t.equal(storage.paths().length, 3, '3 paths');
        t.equal(storage.contents({ history: 'latest' }).length, 3, '3 contents with just heads');
        t.equal(storage.contents({ history: 'all'    }).length, 4, '4 contents with history');

        t.same(storage.paths(), ['/decoy1', '/decoy2', '/path1'], 'paths()');
        t.same(storage.contents({ history: 'latest' }), ['aaa', 'zzz', 'three'], 'contents() with just heads');
        t.same(storage.contents({ history: 'all'    }), ['aaa', 'zzz', 'three', 'two'], 'contents with history, newest first');

        t.same(
            storage.documents({ history: 'all' }).map((doc : Document) => doc.author),
            [author1, author1, author1, author2],
            'docs with history, newest first, docs should have correct authors'
        );

        let sortedAuthors = [author1, author2];
        sortedAuthors.sort();
        t.same(storage.authors(), sortedAuthors, 'authors');

        // TODO: test sorting of docs with 2 authors, same timestamps, different signatures

        t.end();
    });

    t.test(scenario.description + ': sync: push to empty store', (t: any) => {
        let storage1 = scenario.makeStorage(WORKSPACE);
        let storage2 = scenario.makeStorage(WORKSPACE);

        // set up some paths
        t.same(storage1.set(keypair1, {format: FORMAT, path: '/decoy2', content: 'zzz', timestamp: now}), WriteResult.Accepted, 'author1 set decoy path');
        t.same(storage1.set(keypair1, {format: FORMAT, path: '/decoy1', content: 'aaa', timestamp: now}), WriteResult.Accepted, 'author1 set decoy path');
        t.same(storage1.set(keypair1, {format: FORMAT, path: '/path1', content: 'one', timestamp: now}), WriteResult.Accepted, 'author1 set path1');
        t.same(storage1.set(keypair2, {format: FORMAT, path: '/path1', content: 'two', timestamp: now + 1}), WriteResult.Accepted, 'author2 set path1');

        // sync
        let syncResults = storage3LocalSync(storage1, storage2);
        t.same(syncResults, { numPushed: 4, numPulled: 0 }, 'pushed 4 docs (includes history docs).  pulled 0.');

        // check results
        t.same(storage1.paths(), storage2.paths(), 'storage1.paths() == storage3.paths()');
        t.same(storage1.contents({ history: 'latest' }), storage2.contents({ history: 'latest' }), 'storage1 contents == storage3 (heads only)');
        t.same(storage1.contents({ history: 'all'    }), storage2.contents({ history: 'all'    }), 'storage1 contents with history == storage3');

        t.same(storage2.paths(), ['/decoy1', '/decoy2', '/path1'], 'paths are as expected');
        t.same(storage2.getContent('/path1'), 'two', 'latest doc for a path wins on storage3');
        t.same(storage2.getDocument('/path1')?.content, 'two', 'getDocument has correct content');
        t.same(storage2.contents({ history: 'latest' }), ['aaa', 'zzz', 'two'], 'storage3 contents are as expected (heads only)');
        t.same(storage2.contents({ history: 'all'    }), ['aaa', 'zzz', 'one', 'two'], 'contents with history are as expected');

        // sync again.  nothing should happen.
        let syncResults2 = storage3LocalSync(storage1, storage2);
        t.same(syncResults2, { numPushed: 0, numPulled: 0 }, 'nothing happens if syncing again');

        t.end();
    });

    t.test(scenario.description + ': sync: two-way', (t: any) => {
        let storage1 = scenario.makeStorage(WORKSPACE);
        let storage2 = scenario.makeStorage(WORKSPACE);

        // set up some paths
        t.same(storage1.set(keypair1, {format: FORMAT, path: '/decoy2', content: 'zzz', timestamp: now}), WriteResult.Accepted, 'author1 set decoy path');  // winner  (push #1)
        t.same(storage1.set(keypair1, {format: FORMAT, path: '/decoy1', content: 'aaa', timestamp: now}), WriteResult.Accepted, 'author1 set decoy path');  // winner  (push 2)

        t.same(storage1.set(keypair1, {format: FORMAT, path: '/path1', content: 'one', timestamp: now}), WriteResult.Accepted, 'author1 set path1');      // becomes history  (push 3)
        t.same(storage1.set(keypair2, {format: FORMAT, path: '/path1', content: 'two', timestamp: now + 1}), WriteResult.Accepted, 'author2 set path1');  // winner  (push 4)

        t.same(storage2.set(keypair1, {format: FORMAT, path: '/latestOnStorage1', content: '221', timestamp: now}), WriteResult.Accepted);       // dropped
        t.same(storage1.set(keypair1, {format: FORMAT, path: '/latestOnStorage1', content: '111', timestamp: now + 10}), WriteResult.Accepted);  // winner  (push 5)

        t.same(storage1.set(keypair1, {format: FORMAT, path: '/latestOnStorage3', content: '11', timestamp: now}), WriteResult.Accepted);       // dropped
        t.same(storage2.set(keypair1, {format: FORMAT, path: '/latestOnStorage3', content: '22', timestamp: now + 10}), WriteResult.Accepted);  // winner  (pull 1)

        t.same(storage1.set(keypair1, {format: FORMAT, path: '/authorConflict', content: 'author1storage1', timestamp: now}), WriteResult.Accepted);      // becomes history  (push 6)
        t.same(storage2.set(keypair2, {format: FORMAT, path: '/authorConflict', content: 'author2storage3', timestamp: now + 1}), WriteResult.Accepted);  // winner  (pull 2)

        // sync
        let syncResults = storage3LocalSync(storage1, storage2);
        t.same(syncResults, { numPushed: 6, numPulled: 2 }, 'pushed 6 docs, pulled 2 (including history)');

        t.equal(storage1.paths().length, 6, '6 paths');
        t.equal(storage1.documents({ history: 'latest' }).length, 6, '6 docs, heads only');
        t.equal(storage1.documents({ history: 'all'    }).length, 8, '8 docs with history');
        t.equal(storage1.contents({  history: 'latest' }).length, 6, '6 contents, heads only');
        t.equal(storage1.contents({  history: 'all'    }).length, 8, '8 contents with history');

        t.same(storage1.paths(), '/authorConflict /decoy1 /decoy2 /latestOnStorage1 /latestOnStorage3 /path1'.split(' '), 'correct paths on storage1');
        t.same(storage1.contents({ history: 'latest' }), 'author2storage3 aaa zzz 111 22 two'.split(' '), 'correct contents on storage1');

        t.same(storage1.paths(), storage2.paths(), 'paths match');
        t.same(storage1.documents({ history: 'latest' }), storage2.documents({ history: 'latest' }), 'docs match, heads only');
        t.same(storage1.documents({ history: 'all'    }), storage2.documents({ history: 'all'    }), 'docs with history: match');
        t.same(storage1.contents({  history: 'latest' }), storage2.contents({  history: 'latest' }), 'contents match, heads only');
        t.same(storage1.contents({  history: 'all'    }), storage2.contents({  history: 'all'    }), 'contents with history: match');

        t.end();
    });

    t.test(scenario.description + ': sync: mismatched workspaces', (t: any) => {
        let storageA1 = scenario.makeStorage(WORKSPACE);
        let storageA2 = scenario.makeStorage(WORKSPACE);
        let storageB = scenario.makeStorage(WORKSPACE2);
        t.same(storageA1.set(keypair1, {format: FORMAT, path: '/a1', content: 'a1'}), WriteResult.Accepted);
        t.same(storageA2.set(keypair1, {format: FORMAT, path: '/a2', content: 'a2'}), WriteResult.Accepted);
        t.same(storageB.set(keypair1, {format: FORMAT, path: '/b', content: 'b'}), WriteResult.Accepted);

        t.same(storage3LocalSync(storageA1, storageB),  { numPulled: 0, numPushed: 0}, 'sync across different workspaces should do nothing');
        t.same(storage3LocalSync(storageA1, storageA2), { numPulled: 1, numPushed: 1}, 'sync across matching workspaces should do something');

        t.end();
    });

    t.test(scenario.description + ': sync: misc other options', (t: any) => {
        let storageEmpty1 = scenario.makeStorage(WORKSPACE);
        let storageEmpty2 = scenario.makeStorage(WORKSPACE);
        let storageEmpty3 = scenario.makeStorage(WORKSPACE);
        let storage = scenario.makeStorage(WORKSPACE);

        t.same(storage.set(keypair1, {format: FORMAT, path: '/foo', content: 'bar'}), WriteResult.Accepted);

        // sync with empty stores
        t.same(storage3LocalSync( storageEmpty1, storageEmpty2), { numPushed: 0, numPulled: 0 }, 'sync with empty stores');
        t.same(storage3LocalPush( storageEmpty1, storageEmpty2), 0, 'push with empty stores');
        t.same(storage3LocalPush( storageEmpty1, storage      ), 0, 'push from empty to full store');

        // sync with self
        t.same(storage3LocalSync(storage, storage), { numPushed: 0, numPulled: 0 }, 'sync with self should do nothing');

        // successful sync
        t.same(storage3LocalSync(storage, storageEmpty1), { numPushed: 1, numPulled: 0 }, 'successful sync (push)');
        t.same(storage3LocalSync(storageEmpty2, storage), { numPushed: 0, numPulled: 1 }, 'successful sync (pull)');

        t.same(storage3LocalPush(storage, storageEmpty3), 1, 'successful push');

        t.end();
    });

    t.test(scenario.description + ': onWrite basic test', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        let numCalled = 0;
        let unsub = storage.onWrite.subscribe((e: WriteEvent3) => { numCalled += 1 });

        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1.0', timestamp: now}), WriteResult.Accepted, 'set new path');
        t.ok(isErr(storage.set(keypair1, {format: 'xxx', path: '/path1', content: 'val1.1', timestamp: now})), 'invalid set that will be ignored');
        t.equal(storage.getContent('/path1'), 'val1.0', 'second set was ignored');

        t.equal(numCalled, 1, 'callback was called once, synchronously');
        unsub();

        t.same(storage.set(keypair1, {format: FORMAT, path: '/path2', content: 'val2.0', timestamp: now + 1}), WriteResult.Accepted, 'set another path');

        t.equal(numCalled, 1, 'callback was not called after unsubscribing');

        t.end();
    });

    t.test(scenario.description + ': onWrite', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);
        let storage2 = scenario.makeStorage(WORKSPACE);
        let storage3 = scenario.makeStorage(WORKSPACE);
        let storage4 = scenario.makeStorage(WORKSPACE);

        let events: WriteEvent3[] = [];
        let unsub = storage.onWrite.subscribe((e) => { events.push(e) });

        // set new path
        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1+1', timestamp: now + 1}), WriteResult.Accepted, '=== set new path from keypair1');
        t.same(events[events.length-1].document.content, 'val1+1');
        t.same(events[events.length-1].isLocal, true, 'event is local');
        t.same(events[events.length-1].isLatest, true, 'event is latest');
        t.same(events[events.length-1].fromSessionId, storage.sessionId, 'sessionId matches');

        // overwrite from same author
        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1+2', timestamp: now + 2}), WriteResult.Accepted, '=== update same path from keypair1');
        t.same(events[events.length-1].document.content, 'val1+2');
        t.same(events[events.length-1].isLocal, true, 'event is local');
        t.same(events[events.length-1].isLatest, true, 'event is latest');

        // overwrite from a new author
        t.same(storage.set(keypair2, {format: FORMAT, path: '/path1', content: 'val2+3', timestamp: now + 3}), WriteResult.Accepted, '=== update same path from keypair2');
        t.same(events[events.length-1].document.content, 'val2+3');
        t.same(events[events.length-1].isLocal, true, 'event is local');
        t.same(events[events.length-1].isLatest, true, 'event is latest');

        // old write from same author, synced and ignored
        t.same(storage2.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1-9', timestamp: now - 9}), WriteResult.Accepted, '=== old write from keypair1, synced');
        storage3LocalPush(storage2, storage);
        t.same(events.length, 3, 'no event happens because nothing happened in the sync');
        t.same(storage.getContent('/path1'), 'val2+3', 'content is unchanged');

        // new write from same author, synced and used
        t.same(storage3.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1+9', timestamp: now + 9}), WriteResult.Accepted, '=== new write from same author, synced');
        storage3LocalPush(storage3, storage);
        t.same(events.length, 4, 'sync caused an event');
        t.same(storage.getContent('/path1'), 'val1+9', 'content changed after a sync');
        t.same(events[events.length-1].document.content, 'val1+9', 'event has corrent content');
        t.same(events[events.length-1].isLocal, false, 'event is not local (it came from a sync)');
        t.same(events[events.length-1].fromSessionId, storage3.sessionId, 'sessionId matches other storage');
        t.same(events[events.length-1].isLatest, true, 'event is latest');

        // a write from keypair2 which is synced but not a head
        // (it's a new latest doc for keypair2, but not a new latest doc overall for this path)
        t.same(storage4.set(keypair2, {format: FORMAT, path: '/path1', content: 'val2+5', timestamp: now + 5}), WriteResult.Accepted, '=== a write into history, synced');
        let numSynced = storage3LocalPush(storage4, storage);
        t.same(numSynced, 1, 'it was synced');
        t.same(storage.getContent('/path1'), 'val1+9', '(latest) content did not change');
        t.same(events.length, 5, 'an event happens');
        t.same(events[events.length-1].document.content, 'val2+5', 'event has correct content');
        t.same(events[events.length-1].isLocal, false, 'event is not local (it came from a sync)');
        t.same(events[events.length-1].fromSessionId, storage4.sessionId, 'sessionId matches other storage');
        t.same(events[events.length-1].isLatest, false, 'event is not latest');

        // unsubscribe
        let prevLen = events.length;
        unsub();
        t.same(storage.set(keypair1, {format: FORMAT, path: '/z', content: 'foo'}), WriteResult.Accepted, 'do a write after unsubscribing');
        t.same(events.length, prevLen, 'no event happens after unsubscribing');

        t.end();
    });

    t.test(scenario.description + ': doc immutability', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);
        let storage2 = scenario.makeStorage(WORKSPACE);

        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1.0', timestamp: now}), WriteResult.Accepted, 'set new path');
        let doc = storage.getDocument('/path1');
        if (doc === undefined) {
            t.true(false, '???');
            t.end();
            return;
        }
        t.true(Object.isFrozen(doc), 'getDocument: returned doc is frozen');
        let docs = storage.documents({ history: 'all' });
        for (let doc of docs) {
            t.true(Object.isFrozen(doc), 'documents: returned doc is frozen');
        }

        let inputDoc = {...doc};
        t.false(Object.isFrozen(inputDoc), 'input doc is not frozen');
        storage2.ingestDocument(inputDoc, '');
        t.true(Object.isFrozen(inputDoc), 'input doc is now frozen after being ingested');

        t.end();
    });

    t.test(scenario.description + ': set(): manual vs default (bumped) timestamps & bounds-checking timestamps', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        // default timestamps
        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'default now'                       }), WriteResult.Accepted, 'absent timestamp: now');
        t.same(storage.getDocument('/path1')?.timestamp, now, '= now');
        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'default now'                       }), WriteResult.Accepted, 'absent timestamp: bumped');
        t.same(storage.getDocument('/path1')?.timestamp, now + 1, '= now + 1');
        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'default now', timestamp: 0         }), WriteResult.Accepted, 'zero timestamp: bumped');
        t.same(storage.getDocument('/path1')?.timestamp, now + 2, '= now + 2');
        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'default now', timestamp: undefined }), WriteResult.Accepted, 'undefined timestamp: bumped');
        t.same(storage.getDocument('/path1')?.timestamp, now + 3, '= now + 3');

        // manual timestamps
        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'manual now-10', timestamp: now - 10}), WriteResult.Ignored, 'manual timestamp in past from same author is ignored');

        t.same(storage.set(keypair2, {format: FORMAT, path: '/path1', content: 'manual now-10', timestamp: now - 10}), WriteResult.Accepted, 'manual timestamp in past');
        t.same(storage.documents({ author: keypair2.address, history: 'all' })[0].timestamp, now - 10, '= now - 10');

        t.same(storage.set(keypair3, {format: FORMAT, path: '/path1', content: 'manual now+10', timestamp: now + 10}), WriteResult.Accepted, 'manual timestamp in future');
        t.same(storage.documents({ author: keypair3.address, history: 'all' })[0].timestamp, now + 10, '= now + 10');

        // invalid timestamps
        t.ok(storage.set(keypair4, {format: FORMAT, path: '/path1', content: 'milliseconds', timestamp: Date.now() })
            instanceof ValidationError, 'millisecond timestamp: rejected');
        t.ok(storage.set(keypair4, {format: FORMAT, path: '/path1', content: 'milliseconds', deleteAfter: Date.now() })
            instanceof ValidationError, 'millisecond deleteAfter: rejected');
        t.ok(storage.set(keypair4, {format: FORMAT, path: '/path1', content: 'milliseconds', timestamp: now, deleteAfter: now - 5 })
            instanceof ValidationError, 'deleteAfter and timestamp out of order: rejected');

        t.end();
    });

    t.test(scenario.description + ': set(): invalid keypair causes error', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        let keypairBad: AuthorKeypair = {
            address: 'bad address',
            secret: keypair1.secret,
        }
        let result = storage.set(keypairBad, {format: FORMAT, path: '/path1', content: 'hello'});
        t.ok(result instanceof ValidationError, 'set with invalid keypair causes ValidationError');

        let result2 = storage.set(keypair1, {format: FORMAT, path: 'invalid path', content: 'hello'});
        t.ok(result2 instanceof ValidationError, 'set with invalid path causes ValidationError');

        let result3 = storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'hello', timestamp: 3});
        t.ok(result3 instanceof ValidationError, 'set with invalid timestamp causes ValidationError');

        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'hello'}), WriteResult.Accepted, 'write a valid document');
        let result4 = storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'hello', timestamp: 3});
        t.ok(result4 instanceof ValidationError, 'set with invalid timestamp causes ValidationError even if a good document exists');

        t.end();
    });

    t.test(scenario.description + ': set(): without _now override', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);
        storage._now = null;

        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'hello'}), WriteResult.Accepted, 'write a valid document');
        let doc = storage.getDocument('/path1');
        if (doc === undefined) {
            t.true(false, '???');
            t.end();
            return;
        }
        let offset = Math.abs((Date.now() * 1000) - doc.timestamp);
        t.ok(offset < 200 * 1000, 'doc timestamp is within 200ms of actual time');

        // these are obvious but they help us get 100% code coverage
        // since we're letting the storage get the actual current time
        // instead of relying on _now
        t.same(storage.authors(), [keypair1.address], 'authors match');
        t.same(storage.paths(), ['/path1'], 'paths match');
        t.same(storage.documents(), [doc], 'documents match');
        t.same(storage.contents(), ['hello'], 'contents match');

        t.end();
    });

    t.test(scenario.description + ': overwrite expired ephemeral doc with another one', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1!', content: 'hello', timestamp: now, deleteAfter: now+10}), WriteResult.Accepted, 'write ephemeral doc');
        t.same(storage.authors(), [keypair1.address], "doc shows up in authors()");
        storage._now = now + 100;
        t.same(storage.authors(), [], "expired doc does not show up in authors()");
        t.same(storage.getDocument('/path1!'), undefined, "now it's expired and is not returned");

        t.end();
    });

}
