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
    isErr,
} from '../util/types';
import {
    generateAuthorKeypair,
    sha256base32,
} from '../crypto/crypto';
import { ValidatorEs4 } from '../validator/es4';

import {
    IStorageDriver,
} from '../storage2/types2';
import {
    DriverMemory,
} from '../storage2/driverMemory';
import {
    DriverSqlite,
} from '../storage2/driverSqlite';
import {
    QueryOpts2,
    historySortFn
} from '../storage2/query2';
import { uniq } from '../util/helpers';

//================================================================================
// prepare for test scenarios

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
    makeDriver: (workspace: WorkspaceAddress) => IStorageDriver,
    description: string,
}
let scenarios : Scenario[] = [
    {
        makeDriver: (workspace: WorkspaceAddress): IStorageDriver => {
            let driver = new DriverMemory();
            driver.begin(workspace);
            return driver;
        },
        description: 'DriverMemory',
    },
    {
        makeDriver: (workspace: WorkspaceAddress): IStorageDriver => {
            let driver = new DriverSqlite(':memory:');
            driver.begin(workspace);
            return driver;
        },
        description: 'DriverSqlite',
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

for (let scenario of scenarios) {

    t.test(`==== starting test of ==== ${scenario.description}`, (t: any) => {
        t.end();
    });

    t.test(scenario.description + ': empty storage', (t: any) => {
        let driver = scenario.makeDriver(WORKSPACE);
        t.same(driver.authors(now), [], 'empty authors');
        t.same(driver.paths({}, now), [], 'empty path query');
        t.same(driver.documents({}, now), [], 'empty document query');
        driver.close();
        t.end();
    });

    // TODO: make sure the driver is running cleanUpQuery?

    t.test(scenario.description + ': config', (t: any) => {
        let driver = scenario.makeDriver(WORKSPACE);
        t.same(driver._getConfig('foo'), undefined, 'get of unknown key is undefined');

        driver._setConfig('foo', 'bar');
        t.same(driver._getConfig('foo'), 'bar', 'set and get roundtrip');

        driver._setConfig('foo', 'baz');
        t.same(driver._getConfig('foo'), 'baz', 'overwrite and get roundtrip');

        driver._setConfig('zzz', 'zzzzz');
        driver._deleteConfig('foo');
        t.same(driver._getConfig('foo'), undefined, 'delete, --> undefined');
        t.same(driver._getConfig('zzz'), 'zzzzz', 'but other keys remain');

        driver._deleteAllConfig();
        t.same(driver._getConfig('foo'), undefined, 'all are gone after clear');
        t.same(driver._getConfig('zzz'), undefined, 'all are gone after clear');

        driver.close();
        t.end();
    });


    t.test(scenario.description + ': upsert: always overwrite same-path-same-author', (t: any) => {
        let driver = scenario.makeDriver(WORKSPACE);

        let base = { workspace: WORKSPACE };
        let inputDocs = [
            {...base, keypair: keypair1, timestamp: now, path: '/a', content: 'hello'},
            {...base, keypair: keypair1, timestamp: now + 1, path: '/a', content: 'hello'},
            {...base, keypair: keypair1, timestamp: now - 1, path: '/a', content: 'hello'},
        ].map(opts => makeDoc(opts));

        inputDocs.forEach(d => driver._upsertDocument(d));
        let outputDocs = driver.documents({}, now);

        t.same(outputDocs.length, 1, 'upsert should overwrite same-path-same-author');
        t.same(outputDocs[0], inputDocs[inputDocs.length-1], 'upsert always overwrites no matter the timestamp');

        driver.close();
        t.end();
    });

    t.test(scenario.description + ': upsert and authors: basic roundtrip', (t: any) => {
        let driver = scenario.makeDriver(WORKSPACE);

        let base = { workspace: WORKSPACE };
        let inputDocs = [
            {...base, keypair: keypair1, timestamp: now    , path: '/a', content: 'hello'},
            {...base, keypair: keypair1, timestamp: now + 1, path: '/b', content: 'hello'},
            {...base, keypair: keypair2, timestamp: now    , path: '/a', content: 'hello'},
            {...base, keypair: keypair2, timestamp: now - 1, path: '/b', content: 'hello'},
        ].map(opts => makeDoc(opts));

        inputDocs.forEach(d => driver._upsertDocument(d));
        let outputDocs = driver.documents({}, now);

        t.same(outputDocs.length, inputDocs.length, 'upsert should not overwrite these test cases');
        let sortedInputs = [...inputDocs];
        sortedInputs.sort(historySortFn);
        t.same(outputDocs, sortedInputs, 'round-trip is deep-equal, and sorted by historySortFn');

        t.ok(Object.isFrozen(inputDocs[0]), 'upsert inputs are frozen afterwards');

        let expectedAuthors = [author1, author2];
        expectedAuthors.sort();
        t.same(driver.authors(now), expectedAuthors, 'authors are deduped and sorted');

        driver.close();
        t.end();
    });

    t.test(scenario.description + ': documentQuery and pathQuery', (t: any) => {
        let driver = scenario.makeDriver(WORKSPACE);

        let base = { workspace: WORKSPACE };

        let inputDocs: Record<string, Document> = {
            d0: makeDoc({...base, keypair: keypair1, timestamp: now    , path: '/a', content: ''}),
            d1: makeDoc({...base, keypair: keypair1, timestamp: now    , path: '/aa', content: '1'}),
            d2: makeDoc({...base, keypair: keypair1, timestamp: now    , path: '/aa/x', content: '22'}),
            d3: makeDoc({...base, keypair: keypair2, timestamp: now + 1, path: '/b', content: '333'}),
            d4: makeDoc({...base, keypair: keypair3, timestamp: now + 2, path: '/b', content: ''}),
            d5: makeDoc({...base, keypair: keypair1, timestamp: now    , path: '/cc/x', content: '55555'}),
        };
        Object.values(inputDocs).forEach(d => driver._upsertDocument(d));

        let i = inputDocs;
        type TestCase = {
            query: QueryOpts2,
            matches: Document[],
            pathMatches?: Document[], // if path query gives a different result than doc query
            note?: string,
        }
        let testCases: TestCase[] = [
            // EVERYTHING
            {
                query: {},
                matches: [i.d0, i.d1, i.d2, i.d3, i.d4, i.d5],
            },
            // PATH
            {
                query: { path: '/aa' },
                matches: [i.d1],
            },
            {
                query: { path: '/b' },
                matches: [i.d3, i.d4],
                note: 'two authors at one path',
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
                query: { timestamp: now + 1 },
                matches: [i.d3],
            },
            {
                query: { timestamp_gt: 777 },
                matches: [i.d0, i.d1, i.d2, i.d3, i.d4, i.d5],
            },
            {
                query: { timestamp_gt: 0 },
                matches: [i.d0, i.d1, i.d2, i.d3, i.d4, i.d5],
            },
            {
                query: { timestamp_gt: now },
                matches: [i.d3, i.d4],
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
                matches: [i.d0, i.d1, i.d2, i.d5],
            },
            {
                query: { author: author4 },
                matches: [],
            },
            // CONTENT SIZE
            // TODO: test contentSize with utf-8 characters vs bytes
            {
                query: { contentSize: 0 },
                matches: [i.d0, i.d4],
            },
            {
                query: { contentSize: 2 },
                matches: [i.d2],
            },
            {
                query: { contentSize_gt: 0 },
                matches: [i.d1, i.d2, i.d3, i.d5],
            },
            {
                query: { contentSize_lt: 2 },
                matches: [i.d0, i.d1, i.d4],
            },
            // ISHEAD
            {
                query: { isHead: true },
                matches: [i.d0, i.d1, i.d2, i.d4, i.d5],  // not d3
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
                query: { limit: 5 },
                // the first 5 documents only have 4 distinct paths between them.
                // so the first 5 distinct paths reach a little further.
                // (limit is applied after distinct-ifying paths)
                matches: [i.d0, i.d1, i.d2, i.d3, i.d4],
                pathMatches: [i.d0, i.d1, i.d2, i.d3, i.d5],
                note: 'limit should be applied after distinct paths',
            },
            {
                query: { limit: 999 },
                matches: [i.d0, i.d1, i.d2, i.d3, i.d4, i.d5],
            },
            // LIMIT BYTES
            // TODO: test with unicode characters -- should count bytes, not characters
            {
                query: { limitBytes: 0 },
                matches: [],  // don't even get the first '', stop as soon as possible
                // path queries ignore limitBytes
                pathMatches: [i.d0, i.d1, i.d2, i.d3, i.d4, i.d5],
            },
            {
                query: { limitBytes: 1 },
                matches: [i.d0, i.d1],  // '' + '1' <= 1 byte
                pathMatches: [i.d0, i.d1, i.d2, i.d3, i.d4, i.d5],
            },
            {
                query: { limitBytes: 2 },
                matches: [i.d0, i.d1],  // '' + '1' <= 1 byte
                pathMatches: [i.d0, i.d1, i.d2, i.d3, i.d4, i.d5],
            },
            {
                query: { limitBytes: 3 },
                matches: [i.d0, i.d1, i.d2],  // '' + '1' + '22' <= 3 bytes, don't get the following ''
                pathMatches: [i.d0, i.d1, i.d2, i.d3, i.d4, i.d5],
            },
        ];
        for (let testCase of testCases) {
            testCase.matches.sort(historySortFn);
        }

        // test documentQuery
        for (let { query, matches, note } of testCases) {
            note = (note || '') + ' ' + JSON.stringify(query);
            let actualMatches = driver.documents(query, now);
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
            let expectedPaths = uniq(matches.map(m => m.path));
            expectedPaths.sort();
            let actualPaths = driver.paths(query, now);
            t.same(actualPaths, expectedPaths, `pathQuery: all match: ${note}`);
        }

        driver.close();
        t.end();
    });

    // TODO: check that expired docs are not returned from queries

    t.test(scenario.description + ': removeExpiredDocuments', (t: any) => {
        let driver = scenario.makeDriver(WORKSPACE);

        // this should not crash
        driver.removeExpiredDocuments(now);

        // a good doc
        let doc1 = makeDoc({workspace: WORKSPACE, keypair: keypair1, path: '/a', content: 'hello', timestamp: now });
        // a doc that will expire
        let doc2 = makeDoc({workspace: WORKSPACE, keypair: keypair1, path: '/a!', content: 'hello', timestamp: now, deleteAfter: now + 5 });

        driver._upsertDocument(doc1);
        driver._upsertDocument(doc2);

        t.same(driver.paths({}, now).length, 2, 'starting off with 2 docs');

        // remove expired docs as if we were in the future
        driver.removeExpiredDocuments(now + 100);

        // back in the present, query and only find 1
        t.same(driver.paths({}, now).length, 1, 'only 1 remains after expired doc was removed');

        driver.close();
        t.end();
    });

}