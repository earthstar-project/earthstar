import t = require('tap');
//t.runOnly = true;

import {
    AuthorKeypair,
    FormatName,
    isErr,
    IValidator
} from '../util/types';
import { Query } from '../storage/query';
import { ValidatorEs4 } from '../validator/es4';
import { StorageMemory } from '../storage/storageMemory';
import { StorageToAsync } from '../storage/storageToAsync';
import { generateAuthorKeypair } from '../crypto/crypto';

import {
    escapeStringForRegex,
    globToEarthstarQueryAndPathRegex,
    queryByGlobAsync,
    queryByGlobSync
} from '../storage/queryHelpers';

//================================================================================
// prepare for test scenarios

let WORKSPACE = '+gardenclub.xxxxxxxxxxxxxxxxxxxx';

let VALIDATORS: IValidator[] = [ValidatorEs4];
let FORMAT: FormatName = VALIDATORS[0].format;

// tests assume these are in alphabetical order by author shortname
let keypair1 = generateAuthorKeypair('aut1') as AuthorKeypair;
if (isErr(keypair1)) { throw "oops"; }
let author1 = keypair1.address;

//================================================================================

t.test('escapeStringForRegex', (t: any) => {
    let specialChars = '.*+?^${}()|[]' + '\\';
    let normalChars = '`~!@#%&_-=;:",<>/abcABC123' + "'";

    let vectors: [string, string][] = [
        // input (raw string), output (escaped string safe for regex)
        ['', ''],
        ['hello', 'hello'],
    ];
    for (let char of specialChars) {
        vectors.push(['a' + char + 'b', 'a' + '\\' + char + 'b']);
    }
    for (let char of normalChars) {
        vectors.push(['a' + char + 'b', 'a' + char + 'b']);
    }

    for (let [input, correctOutput] of vectors) {
        let actualOutput = escapeStringForRegex(input);
        t.same(actualOutput, correctOutput, `${input} is escaped to ${correctOutput}`);
        let reg = new RegExp(actualOutput);
        t.same(reg.test(input), true, `RegExp(${actualOutput}).test(${input}) is true`);
    }

    t.done();
});

t.test('globToEarthstarQueryAndPathRegex', async (t) => {
    interface Vector {
        glob: string,
        esQuery: Query,
        pathRegex: string | null,
        matchingPaths: string[],
        nonMatchingPaths: string[],
    };
    let vectors: Vector[] = [
        {
            // no asterisks
            glob: '/a',
            esQuery: { path: '/a', contentLengthGt: 0, },  // exact path, not startsWith and endsWith
            pathRegex: null,  // no regex is needed
            matchingPaths: ['/a'],
            nonMatchingPaths: ['/', 'a', '/b', '-/a', '/a-'],
        },
        {
            // one asterisk at beginning
            glob: '*a.txt',
            esQuery: { pathEndsWith: 'a.txt', contentLengthGt: 0, },
            pathRegex: null,  // no regex needed
            matchingPaths: [
                'a.txt',
                '-a.txt',
                '----a.txt',
                '/x/x/xa.txt',
            ],
            nonMatchingPaths: [
                'a-txt',  // the dot should not become a wildcard
                'a.txt-',  // no extra stuff at end
            ],
        },
        {
            // one asterisk at end
            glob: '/abc*',
            esQuery: { pathStartsWith: '/abc', contentLengthGt: 0, },
            pathRegex: null,  // no regex needed
            matchingPaths: [
                '/abc',
                '/abc-',
                '/abc/xyz.foo',
            ],
            nonMatchingPaths: [
                'abc',
                '-/abc/',
            ],
        },
        {
            // one asterisk in the middle
            glob: '/a*a.txt',
            esQuery: { pathStartsWith: '/a', pathEndsWith: 'a.txt', contentLengthGt: 0, },
            pathRegex: '^/a.*a\\.txt$',
            matchingPaths: [
                '/aa.txt',
                '/a/a.txt',
                '/aaaa.txt',
                '/aa/aa.txt',
                '/aa/b/b/b/b/b/aa.txt',
                '/a-----a.txt',
            ],
            nonMatchingPaths: [
                '/a.txt',  // the prefix and suffix should not be able to overlap
                '/aa-txt',  // the dot should not become a wildcard
                '-/aa.txt',  // no extra stuff at beginning
                '/aa.txt-',  // no extra stuff at end
                '-/a-a.txt-',
            ],
        },
        {
            // one asterisk at start and one in the middle
            glob: '*a*b',
            esQuery: { pathEndsWith: 'b', contentLengthGt: 0, },
            pathRegex: '^.*a.*b$',
            matchingPaths: [
                'ab',
                '-ab',
                'a-b',
                '-a-b',
                '---a---b',
            ],
            nonMatchingPaths: [
                'ab-',
                'aa',
            ],
        },
        {
            // one asterisk at end and one in the middle
            glob: 'a*b*',
            esQuery: { pathStartsWith: 'a', contentLengthGt: 0, },
            pathRegex: '^a.*b.*$',
            matchingPaths: [
                'ab',
                'ab-',
                'a-b',
                'a-b-',
                'a---b---',
            ],
            nonMatchingPaths: [
                '-ab',
                'aa',
            ],
        },
        {
            // one asterisk at start and one at end
            glob: '*abc*',
            esQuery: { contentLengthGt: 0, },
            pathRegex: '^.*abc.*$',
            matchingPaths: [
                'abc',
                'abc-',
                '-abc',
                '-abc-',
                '---abc---',
            ],
            nonMatchingPaths: [
                'ac',
            ],
        },
        {
            // one asterisk at start, one in middle, one at end
            glob: '*a*b*',
            esQuery: { contentLengthGt: 0, },
            pathRegex: '^.*a.*b.*$',
            matchingPaths: [
                'ab',
                'ab-',
                '-ab',
                '-ab-',
                '---ab---',
                '---a----b---',
                'a-b',
                '-a-b-',
            ],
            nonMatchingPaths: [
                'ac',
            ],
        },
        {
            // multiple asterisks not at the start or end
            glob: '/foo:*/bar:*.json',
            esQuery: { pathStartsWith: '/foo:', pathEndsWith: '.json', contentLengthGt: 0, },
            pathRegex: '^/foo:.*/bar:.*\\.json$',
            matchingPaths: [
                '/foo:/bar:.json',
                '/foo:a/bar:a.json',
                '/foo:-----/bar:-----.json',
            ],
            nonMatchingPaths: [
                '/foo:.json',  // middle parts should be present
                '-/foo:a/bar:a.json',
                '/foo:a/bar:a.json-',
            ],
        },
    ];

    for (let vector of vectors) {
        let { glob, esQuery, pathRegex, matchingPaths, nonMatchingPaths } = vector;

        let result = globToEarthstarQueryAndPathRegex(glob);

        //log('---');
        //log(JSON.stringify({
        //    ...vector,
        //    result,
        //}, null, 4));

        t.same(result.query, esQuery, 'query is as expected: ' + glob);
        t.same(result.pathRegex, pathRegex, 'regex is as expected: ' + glob);
        if (result.pathRegex != null) {
            let resultRe = new RegExp(result.pathRegex);
            for (let match of matchingPaths) {
                t.true(resultRe.test(match), 'regex should match: ' + match);
            }
            for (let nonMatch of nonMatchingPaths) {
                t.false(resultRe.test(nonMatch), 'regex should not match: ' + nonMatch);
            }
        }
    }

    t.done();
});

//================================================================================
// test queryByGlobSync and queryByGlobAsync

let docPaths = [
    '/aa',
    '/aa/aa/aa/aa/aa',
    '/posts',
    '/posts/123.json',
    '/posts/123.txt',
    '/posts/v1/123.txt',
]
interface QueryVector {
    glob: string,
    expectedPaths: string[],
    note?: string,
}
let queryVectors: QueryVector[] = [
    {
        glob: '*',
        expectedPaths: [...docPaths],
    },
    {
        glob: '/posts/123.txt',
        expectedPaths: ['/posts/123.txt'],
    },
    {
        glob: '/p*s*s/1*3.txt',
        expectedPaths: ['/posts/123.txt'],
    },
    {
        glob: '/posts/*.txt',
        expectedPaths: [
            '/posts/123.txt',
            '/posts/v1/123.txt'
        ],
    },
    {
        glob: '/a*a',
        expectedPaths: [
            '/aa',
            '/aa/aa/aa/aa/aa',
        ],
        note: 'slashes are allowed in the glob',
    },
    {
        glob: '/aa*aa',
        expectedPaths: [
            '/aa/aa/aa/aa/aa',
        ],
        note: 'should not match /aa, unlike when just using prefix and suffix',
    },
    {
        glob: '*.txt',
        expectedPaths: [
            '/posts/123.txt',
            '/posts/v1/123.txt'
        ],
    },
    {
        glob: '/posts/*',
        expectedPaths: [
            '/posts/123.json',
            '/posts/123.txt',
            '/posts/v1/123.txt'
        ],
    },
];

t.test('queryByGlobSync', (t: any) => {
    let storage = new StorageMemory(VALIDATORS, WORKSPACE);
    for (let path of docPaths) {
        storage.set(keypair1, {
            format: 'es.4',
            path: path,
            content: 'content at ' + path,
        });
    }

    for (let vector of queryVectors) {
        let { glob, expectedPaths } = vector;
        let docs = queryByGlobSync(storage, glob);
        let actualPaths = docs.map(doc => doc.path);
        actualPaths.sort();
        expectedPaths.sort();
        let note = vector.note ? ` (${vector.note})` : '';
        t.same(actualPaths, expectedPaths, `glob: ${glob} should match ${expectedPaths.length} paths.${note}`);
    }

    storage.close();
    t.done();
});

t.test('queryByGlobAsync', async (t) => {
    let storage = new StorageToAsync(new StorageMemory(VALIDATORS, WORKSPACE), 10);
    for (let path of docPaths) {
        storage.set(keypair1, {
            format: 'es.4',
            path: path,
            content: 'content at ' + path,
        });
    }

    for (let vector of queryVectors) {
        let { glob, expectedPaths } = vector;
        let docs = await queryByGlobAsync(storage, glob);
        let actualPaths = docs.map(doc => doc.path);
        actualPaths.sort();
        expectedPaths.sort();
        let note = vector.note ? ` (${vector.note})` : '';
        t.same(actualPaths, expectedPaths, `glob: ${glob} should match ${expectedPaths.length} paths.${note}`);
    }

    await storage.close();
    t.done();
});
