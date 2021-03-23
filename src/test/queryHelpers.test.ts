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
        note?: string,
        glob: string,
        esQuery: Query,
        pathRegex: string | null,
        matchingPaths: string[],
        nonMatchingPaths: string[],
    };
    let vectors: Vector[] = [
        {
            note: 'no regex needed',
            glob: '**a.txt',
            esQuery: { pathEndsWith: 'a.txt' },
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
            glob: '*a.txt',
            esQuery: { pathEndsWith: 'a.txt' },
            pathRegex: '^[^/]*a\\.txt$',
            matchingPaths: [
                'a.txt',
                '-a.txt',
                '----a.txt',
            ],
            nonMatchingPaths: [
                '-------a.txt------',  // no extra stuff all around
                '/a.txt', // can't match a slash
                'a-txt',  // the dot should not become a wildcard
            ],
        },
        {
            glob: '/posts/*',
            esQuery: { pathStartsWith: '/posts/' },
            pathRegex: '^/posts/[^/]*$',
            matchingPaths: [
                '/posts/hello',
                '/posts/hello.txt',
            ],
            nonMatchingPaths: [
                '--/posts/hello',
                '/posts/deeper/hello',
            ],
        },
        {
            note: 'no regex needed',
            glob: '/posts/**',
            esQuery: { pathStartsWith: '/posts/' },
            pathRegex: null,
            matchingPaths: [
                '/posts/hello',
                '/posts/hello.txt',
                '/posts/deeper/hello',
            ],
            nonMatchingPaths: [
                '--/posts/hello',
            ],
        },
        {
            glob: '/posts/*.txt',
            esQuery: { pathStartsWith: '/posts/', pathEndsWith: '.txt' },
            pathRegex: '^/posts/[^/]*\\.txt$',
            matchingPaths: [
                '/posts/.txt',
                '/posts/hello.txt',
            ],
            nonMatchingPaths: [
                '-/posts/.txt',
                '-/posts/.txt-',
                '/posts/deeper/hello.txt',
                '/posts/Ztxt',  // period is not a wildcard
            ],
        },
        {
            glob: '/posts/**.txt',
            esQuery: { pathStartsWith: '/posts/', pathEndsWith: '.txt' },
            pathRegex: '^/posts/.*\\.txt$',
            matchingPaths: [
                '/posts/.txt',
                '/posts/hello.txt',
                '/posts/deeper/hello.txt',
            ],
            nonMatchingPaths: [
                '-/posts/.txt',
                '/posts/.txt-',
                '/posts/Ztxt',  // period is not a wildcard
            ],
        },
        {
            glob: '/aaa/**/*.txt',
            esQuery: { pathStartsWith: '/aaa/', pathEndsWith: '.txt' },
            pathRegex: '^/aaa/.*/[^/]*\\.txt$',
            matchingPaths: [
                '/aaa//.txt',
                '/aaa/z/z.txt',
                '/aaa/xxx/yyy/zzz.txt',
            ],
            nonMatchingPaths: [
                '/aaa/zzz.txt',
                '/aaa/xx/zzzPtxt',
            ],
        },
        {
            glob: '/aaaa*aaaa',
            esQuery: { pathStartsWith: '/aaaa', pathEndsWith: 'aaaa' },
            pathRegex: '^/aaaa[^/]*aaaa$',
            matchingPaths: [
                '/aaaaaaaa',
                '/aaaa_aaaa',
                '/aaaa______aaaa',
            ],
            nonMatchingPaths: [
                '/aaaa',  // no overlap allowed even though pathStartsWith and pathEndsWith can overlap
                '/aaaa/aaaa',
            ],
        },
        {
            glob: '**a**',
            esQuery: { },
            pathRegex: '^.*a.*$',
            matchingPaths: [
                'a',
                '/a',
                'a----',
                '-/---a-/--',
                'aaaaaaaaaaaaaa',
            ],
            nonMatchingPaths: [
                'b',
            ],
        },
        {
            glob: '*a*',
            esQuery: { },
            pathRegex: '^[^/]*a[^/]*$',
            matchingPaths: [
                'a',
                'a----',
                '---a',
                'aaaaaaaaaaaaaa',
            ],
            nonMatchingPaths: [
                '/a',
                'a/',
                '/a/',
                '----/---a----/----',
            ],
        },
    ];

    for (let vector of vectors) {
        let { glob, esQuery, pathRegex, matchingPaths, nonMatchingPaths } = vector;

        let result = globToEarthstarQueryAndPathRegex(glob);

        t.same(true, true, `--- ${vector.glob}   ${vector.note ?? ''} ---`);
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
    '/a---a',
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
        expectedPaths: [],
    },
    {
        glob: '**',
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
        ],
    },
    {
        glob: '/posts/**.txt',
        expectedPaths: [
            '/posts/123.txt',
            '/posts/v1/123.txt'
        ],
    },
    {
        glob: '/a*a',
        expectedPaths: [
            '/aa',
            '/a---a',
        ],
    },
    {
        glob: '/a**a',
        expectedPaths: [
            '/aa',
            '/a---a',
            '/aa/aa/aa/aa/aa'
        ],
    },
    {
        glob: '/aa*aa',
        expectedPaths: [
        ],
    },
    {
        glob: '/aa**aa',
        expectedPaths: [
            '/aa/aa/aa/aa/aa'
        ],
    },
    {
        glob: '*.txt',
        expectedPaths: [
        ],
    },
    {
        glob: '**.txt',
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
        ],
    },
    {
        glob: '/posts/**',
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
        // TODO: all these test docs are by author1, so this isn't a very good test
        // of moreQueryOptions, but it's better than nothing.
        let docs = queryByGlobSync(storage, glob, { author: keypair1.address });
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
