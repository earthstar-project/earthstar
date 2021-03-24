import t = require('tap');
//t.runOnly = true;

import {
    AuthorKeypair,
    FormatName,
    isErr,
    IValidator,
    ValidationError
} from '../util/types';
import { Query } from '../storage/query';
import { ValidatorEs4 } from '../validator/es4';
import { StorageMemory } from '../storage/storageMemory';
import { StorageToAsync } from '../storage/storageToAsync';
import { generateAuthorKeypair } from '../crypto/crypto';

import {
    escapeStringForRegex,
    globToEarthstarQueryAndPathRegex,
    matchTemplateAndPath,
    queryByGlobAsync,
    queryByGlobSync,
    _matchRegexAndPath,
    _templateToPathMatcherRegex
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

//================================================================================

t.test('matchTemplateAndPath', (t: any) => {

    type StringToString = Record<string, string>;
    interface ValidVector {
        template: string,
        glob?: string,
        varNames: string[],
        pathsAndExtractedVars: Record<string, StringToString | null>,
    }
    interface InvalidVector {
        template: string,
        invalid: true;
    }
    type Vector = ValidVector | InvalidVector;
    let vectors: Vector[] = [
        {
            template: '',
            glob: '',
            varNames: [],
            pathsAndExtractedVars: {
                '/novars.json': null,
                '/nope': null,
                '': {},
            },
        },
        {
            template: '/novars.json',
            glob: '/novars.json',
            varNames: [],
            pathsAndExtractedVars: {
                '/novars.json': {},
                '/nope': null,
                '': null,
            },
        },
        {
            template: '/onevar/{_underscores_CAPS_and_digits_12345}.json',
            glob: '/onevar/*.json',
            varNames: ['_underscores_CAPS_and_digits_12345'],
            pathsAndExtractedVars: {
                '/onevar/123.json': { '_underscores_CAPS_and_digits_12345': '123' },
            },
        },
        {
            template: '/onevar/{___}.json',
            glob: '/onevar/*.json',
            varNames: ['___'],
            pathsAndExtractedVars: {
                '/onevar/123.json': { '___': '123' },
            },
        },
        {
            template: '/onevar/{_0}.json',
            glob: '/onevar/*.json',
            varNames: ['_0'],
            pathsAndExtractedVars: {
                '/onevar/123.json': { '_0': '123' },
            },
        },
        {
            template: '/onevar/{postId}.json',
            glob: '/onevar/*.json',
            varNames: ['postId'],
            pathsAndExtractedVars: {
                '/onevar/123.json': { postId: '123' },
                '/onevar/12/34.json': null, // variable can't span across a path segment ('/')
                '/onevar/.json': null,
                '/nope': null,
                '': null,
            },
        },
        {
            template: '/onevar/post:{postId}.json',
            glob: '/onevar/post:*.json',
            varNames: ['postId'],
            pathsAndExtractedVars: {
                '/onevar/post:123.json': { postId: '123' },
            },
        },
        {
            template: '/onevar/thisIsPost{postId}yesThatOne.json',
            glob: '/onevar/thisIsPost*yesThatOne.json',
            varNames: ['postId'],
            pathsAndExtractedVars: {
                '/onevar/thisIsPost123yesThatOne.json': { postId: '123' },
            },
        },
        {
            template: '/twovars/{category}/{postId}.json',
            glob: '/twovars/*/*.json',
            varNames: ['category', 'postId'],
            pathsAndExtractedVars: {
                '/twovars/gardening/123.json': { category: 'gardening', postId: '123' },
                '/twovars/gardening/123.txt': null,
                '/twovars//123.json': null,
                '/twovars/gardening': null,
                '/nope': null,
                '': null,
            },
        },
        {
            template: '/twovars/{category}/{postId}.{ext}',
            glob: '/twovars/*/*.*',
            varNames: ['category', 'postId', 'ext'],
            pathsAndExtractedVars: {
                '/twovars/gardening/123.json': { category: 'gardening', postId: '123', ext: 'json' },
                '/twovars//123.json': null,
                '/twovars/gardening': null,
                '/nope': null,
                '': null,
            },
        },
        //--------------------------------------------------
        // invalid: should throw a Validation Error
        { invalid: true, template: '/two/consecutive/vars/{a}{b}/in/a/row' },
        { invalid: true, template: '/var/starting/with/number/{0abc}' },
        { invalid: true, template: '/var/with/no/name/{}' },
        { invalid: true, template: '/var/with/space/for/name/{ }' },
        { invalid: true, template: '/var/{ withspaces }' },
        { invalid: true, template: '/{one}/{ invalid }/{var}/in-the-middle' },
        { invalid: true, template: '/var/{with-dashes}' },
        { invalid: true, template: '/var/{with/slash}' },
        { invalid: true, template: '/var/{only/one/opening/brace' },
        { invalid: true, template: '/var/only/one/closing}/brace' },
        { invalid: true, template: '/var/{weirdly{nested}/braces/a' },
        { invalid: true, template: '/var/{weirdly}nested}/braces/a' },
        { invalid: true, template: '/var/{recursivly{nested}braces}/a' },
        { invalid: true, template: '/var/}backwards{/braces' },
        { invalid: true, template: '/var/{normal}/and/}backwards{/braces' },
    ];

    for (let vector of vectors) {
        if ('invalid' in vector) {
            try {
                t.true(true, `---  ${vector.template}  ---`);
                // this should throw a ValidationError
                let _thisShouldThrow = _templateToPathMatcherRegex(vector.template);
                t.true(false, `${vector.template} - should throw a ValidationError but did not (_template...)`);
            } catch (err) {
                if (err instanceof ValidationError) {
                    t.true(true, `should throw a ValidationError (message was: ${err.message})`);
                } else {
                    t.true(false, 'should throw a ValidationError but instead threw a ' + err.name);
                    console.error(err);
                }
            }

            try {
                // this should also throw a ValidationError
                let _thisShouldThrow = matchTemplateAndPath(vector.template, '/hello');
                t.true(false, `${vector.template} - should throw a ValidationError but did not (matchTemplate...)`);
            } catch (err) {
                if (err instanceof ValidationError) {
                    t.true(true, `should throw a ValidationError (message was: ${err.message})`);
                } else {
                    t.true(false, 'should throw a ValidationError but instead threw a ' + err.name);
                    console.error(err);
                }
            }
        } else {
            // should be valid

            t.true(true, `---  ${vector.template}  ---`);
            let { varNames, glob, pathMatcherRe } = _templateToPathMatcherRegex(vector.template);
            t.same(varNames, vector.varNames, 'varNames should match');
            if (vector.glob !== undefined) {
                t.same(glob, vector.glob, 'glob should match');
            }

            for (let [path, expectedVars] of Object.entries(vector.pathsAndExtractedVars)) {
                let actualVars = _matchRegexAndPath(pathMatcherRe, path);
                t.same(actualVars, expectedVars, `${path} - extracted variables should match (_matchRegexAndPath)`);
                t.same(matchTemplateAndPath(vector.template, path), expectedVars, `${path} - extracted variables should match (matchTemplateAndPath)`);
            }
        }
    }

    t.done();
});