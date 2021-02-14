import * as fs from 'fs';
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
    notErr,
} from '../util/types';
import {
    generateAuthorKeypair,
    sha256base32,
} from '../crypto/crypto';
import { ValidatorEs4 } from '../validator/es4';

import {
    Query,
    cleanUpQuery,
    documentIsExpired,
    queryMatchesDoc,
    sortLatestFirst,
    sortPathAscAuthorAsc,
    validateQuery,
} from '../storage/query';

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

let shuffleArray = <T>(arr: T[]): void => {
    arr.sort(() => Math.random() - 0.5);
}

t.test('sortPathAscAuthorAsc and sortLatestFirst', (t: any) => {
    // these fake documents are good enough for testing the sort function
    let dA1 = {path: '/a', author: '@x', timestamp: 100, signature: 'fff', content: 'dA1'} as Document;
    let dA2 = {path: '/a', author: '@y', timestamp: 107, signature: 'ggg', content: 'dA2'} as Document;
    let dA3 = {path: '/a', author: '@z', timestamp: 102, signature: 'bbb', content: 'dA3'} as Document;
    let dB1 = {path: '/b', author: '@x', timestamp: 100, signature: 'aaa', content: 'dB1'} as Document;
    let dB2 = {path: '/b', author: '@z', timestamp: 102, signature: 'eee', content: 'dB2'} as Document;

    let expectedPathAuthor = [dA1, dA2, dA3, dB1, dB2];
    let shuffledPathAuthor = [...expectedPathAuthor];
    for (let ii = 0; ii < 10; ii++) {
        shuffleArray(shuffledPathAuthor);
        shuffledPathAuthor.sort(sortPathAscAuthorAsc);
        t.same(shuffledPathAuthor, expectedPathAuthor, 'sortPathAscAuthorAsc sorted correctly');
    }

    let expectedLatestFirst = [
        dA2,       // time: 107
        dA3, dB2,  // time: 102.  sig: bbb, then eee
        dB1, dA1,  // time: 100.  sig: aaa, then fff
    ];
    let shuffledLatestFirst = [...expectedLatestFirst];
    for (let ii = 0; ii < 10; ii++) {
        shuffleArray(shuffledLatestFirst);
        shuffledLatestFirst.sort(sortLatestFirst);
        t.same(shuffledLatestFirst, expectedLatestFirst, 'sortLatestFirst sorted correctly');
    }

    // make sure the sort is stable
    let expectedClones = [{...dA1}, {...dA1}, {...dA1}, {...dA1}, {...dA1}, {...dA1}, {...dA1}];
    let shuffledClones = [...expectedClones];
    shuffleArray(shuffledClones);
    shuffledClones.sort(sortPathAscAuthorAsc);
    t.same(shuffledClones, expectedClones, 'sortPathAscAuthorAsc is stable');
    shuffledClones.sort(sortLatestFirst);
    t.same(shuffledClones, expectedClones, 'sortLatestFirst is stable');

    t.end();
});

t.test('cleanUpQuery', (t: any) => {
    type TestCase = {
        query: Query,
        result: Query | 'same',
        note?: string,
    }
    let testCases: TestCase[] = [
        {
            query: {},
            result: { history: 'latest' },
        },
        {
            query: { history: '???' } as any,
            result: { path: 'invalid-query', limit: 0 },
            note: 'invalid query turns to empty query',
        }
    ];

    for (let { query, result, note } of testCases) {
        note = (note || '') + ' ' + JSON.stringify(query);
        let expected = result === 'same' ? query : result;
        t.same(cleanUpQuery(query), expected, note);
    }

    t.end();
});

t.test('validateQuery', (t: any) => {
    type TestCase = {
        query: Query,
        valid: boolean,
        note?: string,
    }
    let testCases: TestCase[] = [
        { valid: true, query: {}, },

        { valid: true, query: { path: '/a' }, },
        { valid: true, query: { path: 'not-a-valid-path-but-still-ok-in-query' }, },

        { valid: true,  query: { limit: 1 }, },
        { valid: true,  query: { limit: 0 }, },
        { valid: false, query: { limit: -1 }, },

        { valid: true,  query: { limitBytes: 1 }, },
        { valid: true,  query: { limitBytes: 0 }, },
        { valid: false, query: { limitBytes: -1 }, },

        { valid: true,  query: { contentLength: 1 }, },
        { valid: true,  query: { contentLength: 0 }, },
        { valid: false, query: { contentLength: -1 }, },

        { valid: true,  query: { history: 'all' }, },
        { valid: true,  query: { history: 'latest' }, },
        { valid: false, query: { history: null } as any, },
        { valid: false, query: { history: '???' } as any, },
    ];

    for (let { query, valid, note } of testCases) {
        note = (note || '') + ' ' + JSON.stringify(query);
        let err = validateQuery(query);
        t.same(notErr(err), valid, note);
    }

    t.end();
});

t.test('documentIsExpired', (t: any) => {
    let base = { workspace: WORKSPACE };
    let inputDocs: Record<string, Document> = {
        dm1: makeDoc({...base, keypair: keypair1, timestamp: now-10, deleteAfter: now-1, path: '/a', content: ''}),
        d0:  makeDoc({...base, keypair: keypair1, timestamp: now-10, deleteAfter: now  , path: '/b', content: '1'}),
        dp1: makeDoc({...base, keypair: keypair1, timestamp: now-10, deleteAfter: now+1, path: '/c', content: '22'}),
        dx:  makeDoc({...base, keypair: keypair1, timestamp: now-10,                     path: '/c', content: '22'}),
    };

    t.same(documentIsExpired(inputDocs.dm1, now), true,  'now-1 should be expired');
    t.same(documentIsExpired(inputDocs.d0 , now), false, 'now   should not be expired');
    t.same(documentIsExpired(inputDocs.dp1, now), false, 'now+1 should not be expired');
    t.same(documentIsExpired(inputDocs.dx , now), false, 'permanent document should not be expired');

    t.end();
});

t.test('unicode characters vs bytes', (t: any) => {
    let base = { workspace: WORKSPACE };
    let docs: Document[] = [
        makeDoc({...base, keypair: keypair1, timestamp: now, path: '/0', content: ''}),
        makeDoc({...base, keypair: keypair1, timestamp: now, path: '/1', content: '1'}),
        makeDoc({...base, keypair: keypair1, timestamp: now, path: '/2', content: '22' }),
        makeDoc({...base, keypair: keypair1, timestamp: now, path: '/3', content: SNOWMAN}),  // 1 unicode character, 3 bytes
        makeDoc({...base, keypair: keypair2, timestamp: now, path: '/4', content: '4444'}),
    ];
    t.same(docs.filter(d => queryMatchesDoc({ contentLength: 0 }, d)).map(d => d.path), ['/0'], 'contentLength 0');
    t.same(docs.filter(d => queryMatchesDoc({ contentLength: 1 }, d)).map(d => d.path), ['/1'], 'contentLength 1 (no snowman)');
    t.same(docs.filter(d => queryMatchesDoc({ contentLength: 2 }, d)).map(d => d.path), ['/2'], 'contentLength 2');
    t.same(docs.filter(d => queryMatchesDoc({ contentLength: 3 }, d)).map(d => d.path), ['/3'], 'contentLength 3 (snowman)');
    t.same(docs.filter(d => queryMatchesDoc({ contentLength: 4 }, d)).map(d => d.path), ['/4'], 'contentLength 4');
    t.same(docs.filter(d => queryMatchesDoc({ contentLength: 77 }, d)).map(d => d.path), [], 'contentLength 77');

    t.end();
});

t.test('queryMatchesDoc', (t: any) => {
    let base = { workspace: WORKSPACE };
    let inputDocs: Record<string, Document> = {
        d0: makeDoc({...base, keypair: keypair1, timestamp: now    , path: '/a', content: ''}),
        d1: makeDoc({...base, keypair: keypair1, timestamp: now    , path: '/aa', content: '1'}),
        d2: makeDoc({...base, keypair: keypair1, timestamp: now    , path: '/aa/x', content: '22'}),
        d3: makeDoc({...base, keypair: keypair2, timestamp: now + 1, path: '/b', content: '333'}),
        d4: makeDoc({...base, keypair: keypair3, timestamp: now + 2, path: '/b', content: ''}),
        d5: makeDoc({...base, keypair: keypair1, timestamp: now    , path: '/cc/x', content: '55555'}),
    };

    // NOTE: we can't test history: 'latest' here --
    // queryMatchesDoc only runs on one document at a time, in isolation,
    // so it doesn't know if the doc is latest or not.

    let i = inputDocs;
    type TestCase = {
        query: Query,
        matches: Document[],
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
            query: { pathStartsWith: '/aa' },
            matches: [i.d1, i.d2],
        },
        {
            query: { pathStartsWith: 'no such prefix' },
            matches: [],
        },
        // PATH SUFFIX
        {
            query: { pathEndsWith: '/x' },
            matches: [i.d2, i.d5],
        },
        {
            query: { pathEndsWith: 'no such suffix' },
            matches: [],
        },
        // PATH PREFIX AND SUFFIX TOGETHER
        {
            query: { pathStartsWith: '/a', pathEndsWith: 'a' },
            matches: [i.d0, i.d1],
            note: 'overlapping prefix and suffix',
        },
        {
            query: { pathStartsWith: '/c', pathEndsWith: 'x' },
            matches: [i.d5],
            note: 'non-overlapping prefix and suffix',
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
            query: { timestampGt: 777 },
            matches: [i.d0, i.d1, i.d2, i.d3, i.d4, i.d5],
        },
        {
            query: { timestampGt: 0 },
            matches: [i.d0, i.d1, i.d2, i.d3, i.d4, i.d5],
        },
        {
            query: { timestampGt: now },
            matches: [i.d3, i.d4],
        },
        {
            query: { timestampLt: 0 },
            matches: [],
        },
        {
            query: { timestampLt: 777 },
            matches: [],
        },
        {
            query: { timestampLt: now + 1 },
            matches: [i.d0, i.d1, i.d2, i.d5],
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
        {
            query: { contentLength: 0 },
            matches: [i.d0, i.d4],
        },
        {
            query: { contentLength: 2 },
            matches: [i.d2],
        },
        {
            query: { contentLengthGt: 0 },
            matches: [i.d1, i.d2, i.d3, i.d5],
        },
        {
            query: { contentLengthLt: 2 },
            matches: [i.d0, i.d1, i.d4],
        },
        // CONTINUE AFTER
        {
            query: { continueAfter: { path: '/b', author: author2 } },
            matches: [i.d4, i.d5],
        },
        {
            query: { continueAfter: { path: '/aa', author: author1 } },
            matches: [i.d2, i.d3, i.d4, i.d5],
        },
    ];
    for (let testCase of testCases) {
        testCase.matches.sort(sortPathAscAuthorAsc);
    }

    // test documentQuery
    let docSummary = (doc: Document): string =>
        `${doc.path} = ${doc.content || "''"} by ${doc.author.split('.')[0]}`;
    for (let { query, matches, note } of testCases) {
        note = (note || '') + ' ' + JSON.stringify(query);
        let actualMatches = Object.values(inputDocs).filter(doc => queryMatchesDoc(query, doc));
        if (matches.length !== actualMatches.length) {
            t.same(actualMatches.length, matches.length, `correct number of results: ${note}`);
        } else {
            t.same(actualMatches.map(docSummary), matches.map(docSummary), `docs match: ${note}`);
            t.same(actualMatches, matches, `all match: ${note}`);
        }
    }

    t.end();
});

