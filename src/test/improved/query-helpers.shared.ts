
import t = require('tap');
import { onFinishOneTest } from '../browser-run-exit';
import { doesNotThrow, throws } from '../test-utils';

import { Crypto } from '../../crypto/crypto';
import { Query } from '../../query/query-types';
import { FormatValidatorEs4 } from '../../format-validators/format-validator-es4';
import { IStorageAsync } from '../../storage/storage-types';
import { StorageAsync } from '../../storage/storage-async';
import { ValidationError } from '../../util/errors';
import { AuthorKeypair, WorkspaceAddress } from '../../util/doc-types';
import { microsecondNow } from '../../util/misc';

import { TestScenario } from './test-scenario-types';

//================================================================================

import {
  Logger, LogLevel, setLogLevel,
} from '../../util/log';

import {
  _matchAll,
  escapeStringForRegex,
  extractTemplateVariablesFromPath,
  extractTemplateVariablesFromPathUsingRegex,
  globToQueryAndRegex,
  insertVariablesIntoTemplate,
  parseTemplate,
  queryByGlobAsync,
  queryByTemplateAsync,
} from '../../query/query-helpers';

export let runQueryHelpersTests = async (scenario: TestScenario) => {
  let TEST_NAME = 'Query Helpers tests';
  let SUBTEST_NAME = scenario.name;

  // Boilerplate to help browser-run know when this test is completed.
  // When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function.
  /* istanbul ignore next */
  (t.test as any)?.onFinish?.(() => onFinishOneTest(TEST_NAME, SUBTEST_NAME));

  let makeStorage = (ws: WorkspaceAddress): IStorageAsync => {
    let driver = scenario.makeDriver(ws);
    return new StorageAsync(ws, FormatValidatorEs4, driver);
  }

  let keypair1 = await Crypto.generateAuthorKeypair('aut1') as AuthorKeypair;

  let logger = new Logger('query helpers test', 'yellowBright');

  //================================================================================
  // HELPERS

  t.test(SUBTEST_NAME + ': escapeStringForRegex', (t: any) => {
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

    t.end();
  });

  t.test(SUBTEST_NAME + ':_matchAll', (t: any) => {
    let gMatches = _matchAll(new RegExp(/\d/g), '123');
    let gMatchStrings = gMatches.map(m => m[0]);
    t.same(gMatches.length, 3, 'three matches with "g" flag');
    t.same(gMatchStrings, ['1', '2', '3'], '1, 2, 3');

    t.throws(() => _matchAll(new RegExp(/\d/), '123'), 'should throw without "g" flag');

    t.end();
  });

  //================================================================================
  // GLOBS

  t.test(SUBTEST_NAME + ': globToQueryAndRegex', (t) => {
    interface Vector {
      note?: string,
      glob: string,
      esQuery: Query,
      regex: string | null,
      matchingPaths: string[],
      nonMatchingPaths: string[],
    };

    let vectors: Vector[] = [
      {
        note: 'no regex needed',
        glob: '**a.txt',
        esQuery: { filter: { pathEndsWith: 'a.txt' } },
        regex: null,  // no regex needed
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
        esQuery: { filter: { pathEndsWith: 'a.txt' } },
        regex: '^[^/]*a\\.txt$',
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
        esQuery: { filter: { pathStartsWith: '/posts/' } },
        regex: '^/posts/[^/]*$',
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
        esQuery: { filter: { pathStartsWith: '/posts/' } },
        regex: null,
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
        esQuery: { filter: { pathStartsWith: '/posts/', pathEndsWith: '.txt' } },
        regex: '^/posts/[^/]*\\.txt$',
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
        esQuery: { filter: { pathStartsWith: '/posts/', pathEndsWith: '.txt' } },
        regex: '^/posts/.*\\.txt$',
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
        esQuery: { filter: { pathStartsWith: '/aaa/', pathEndsWith: '.txt' } },
        regex: '^/aaa/.*/[^/]*\\.txt$',
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
        esQuery: { filter: { pathStartsWith: '/aaaa', pathEndsWith: 'aaaa' } },
        regex: '^/aaaa[^/]*aaaa$',
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
        esQuery: {},
        regex: '^.*a.*$',
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
        glob: '**',
        esQuery: {},
        regex: null,  // no regex needed, we just want everything
        matchingPaths: [
          'a',
          '/a',
          'a----',
          '-/---a-/--',
          'aaaaaaaaaaaaaa',
        ],
        nonMatchingPaths: [
        ],
      },
      {
        glob: '*a*',
        esQuery: {},
        regex: '^[^/]*a[^/]*$',
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
      let { glob, esQuery, regex, matchingPaths, nonMatchingPaths } = vector;

      let result = globToQueryAndRegex(glob);

      t.same(true, true, `--- ${vector.glob}   ${vector.note ?? ''} ---`);
      t.same(result.query, esQuery, 'query is as expected: ' + glob);
      t.same(result.regex, regex, 'regex is as expected: ' + glob);
      if (result.regex != null) {
        let resultRe = new RegExp(result.regex);
        for (let match of matchingPaths) {
          t.true(resultRe.test(match), 'regex should match: ' + match);
        }
        for (let nonMatch of nonMatchingPaths) {
          t.false(resultRe.test(nonMatch), 'regex should not match: ' + nonMatch);
        }
      }
    }

    try {
      globToQueryAndRegex('***');
      t.true(false, 'three stars should have thrown but did not');
    } catch (err) {
      if (err instanceof ValidationError) {
        t.true(true, 'three stars should throw a ValidationError');
      } else {
        t.true(false, 'three stars threw something besides a ValidationError');
        throw err
      }
    }

    t.end();
  });

  //================================================================================
  // GLOB: USER-FACING API CALLS

  let docPathsForGlobTest = [
    '/aa',
    '/a---a',
    '/aa/aa/aa/aa/aa',
    '/posts',
    '/posts/123.json',
    '/posts/123.txt',
    '/posts/v1/123.txt',
  ]

  interface GlobQueryVector {
    glob: string,
    expectedPaths: string[],
    note?: string,
  }

  let globQueryVectors: GlobQueryVector[] = [
    {
      glob: '*',
      expectedPaths: [],
    },
    {
      glob: '**',
      expectedPaths: [...docPathsForGlobTest],
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

  t.test(SUBTEST_NAME + ': queryByGlobAsync', async (t) => {
    let workspace = '+gardening.abcde';
    let storage   = makeStorage(workspace);
    let now       = microsecondNow();

    for (let path of docPathsForGlobTest) {
      await storage.set(keypair1, {
        format: 'es.4',
        path: path,
        content: 'content at ' + path,
        timestamp: now
      });
    }

    for (let vector of globQueryVectors) {
      let { glob, expectedPaths } = vector;
      let docs = await queryByGlobAsync(storage, glob);
      let actualPaths = docs.map(doc => doc.path);

      actualPaths.sort();
      expectedPaths.sort();

      logger.debug({ glob, docs, actualPaths, expectedPaths })
      let note = vector.note ? ` (${vector.note})` : '';
      t.same(actualPaths, expectedPaths, `glob: ${glob} should match ${expectedPaths.length} paths.${note}`);

      let docsLimit2 = await queryByGlobAsync(storage, glob, { limit: 1 });
      t.true(docsLimit2.length <= 1, 'limit was applied');
    }

    await storage.close(true);
    t.end();
  });

  //================================================================================
  // TEMPLATES

  t.test(SUBTEST_NAME + ': parseTemplate and extractTemplateVariablesFromPath', (t: any) => {
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
          '/onevar/.json': { postId: '' },  // empty matches are ok
          '/onevar/12/34.json': null, // variable can't span across a path segment ('/')
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
        template: '/twovars/cat:{category}/{postId}.json',
        glob: '/twovars/cat:*/*.json',
        varNames: ['category', 'postId'],
        pathsAndExtractedVars: {
          '/twovars/cat:gardening/123.json': { category: 'gardening', postId: '123' },
          '/twovars/cat:gardening/123.txt': null,
          '/twovars/cat:/123.json': { category: '', postId: '123' },
          '/twovars/cat:gardening': null,
          '/nope': null,
          '': null,
        },
      },
      {
        template: '/threevars/{category}/{postId}.{ext}',
        glob: '/threevars/*/*.*',
        varNames: ['category', 'postId', 'ext'],
        pathsAndExtractedVars: {
          '/threevars/gardening/123.json': { category: 'gardening', postId: '123', ext: 'json' },
          // (note that this test example is not a valid earthstar path because it contains '//')
          '/threevars//123.json': { category: '', postId: '123', ext: 'json' },
          '/threevars/gardening': null,
          '/nope': null,
          '': null,
        },
      },
      {
        template: '**/varsAndStars/*/{id}.json',
        glob: '**/varsAndStars/*/*.json',
        varNames: ['id'],
        pathsAndExtractedVars: {
          '/a/b/c/varsAndStars/something/id1.json': { id: 'id1' },
          '/aaa/varsAndStars/something/id1.json': { id: 'id1' },
          '/aaa/varsAndStars/something/id1.txt': null,
          '/aaa/varsAndStars/two/parts/id1.json': null,
          '/nope': null,
          '': null,
        },
      },
      //--------------------------------------------------
      // invalid: should throw a Validation Error
      { invalid: true, template: '/same/var/repeated/twice/{a}/{a}' },
      { invalid: true, template: '/var/touching/*{star}' },
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
          t.true(true, `_parseTemplate...`);
          // this should throw a ValidationError
          let _thisShouldThrow = parseTemplate(vector.template);
          t.true(false, `${vector.template} - should throw a ValidationError but did not (_template...)`);
        } catch (err: any) {
          if (err instanceof ValidationError) {
            t.true(true, `${vector.template} - should throw a ValidationError`);// (message was: ${err.message})`);
          } else {
            t.true(false, `${vector.template} - should throw a ValidationError but instead threw a ${err.name}`);
            console.error(err);
          }
        }

        try {
          t.true(true, `extractTemplateVariablesFromPath`);
          // this should also throw a ValidationError
          let _thisShouldThrow = extractTemplateVariablesFromPath(vector.template, '/hello');
          t.true(false, `${vector.template} - should throw a ValidationError but did not (matchTemplate...)`);
        } catch (err: any) {
          if (err instanceof ValidationError) {
            t.true(true, `${vector.template} - should throw a ValidationError`);// (message was: ${err.message})`);
          } else {
            t.true(false, `${vector.template} - should throw a ValidationError but instead threw a ${err.name}`);
            console.error(err);
          }
        }
      } else {
        // should be valid

        t.true(true, `---  ${vector.template}  ---`);
        let { varNames, glob, namedCaptureRegex } = parseTemplate(vector.template);
        t.same(varNames, vector.varNames, 'varNames should match');
        if (vector.glob !== undefined) {
          t.same(glob, vector.glob, 'glob should match');
        }

        for (let [path, expectedVars] of Object.entries(vector.pathsAndExtractedVars)) {
          let actualVars = extractTemplateVariablesFromPathUsingRegex(namedCaptureRegex, path);
          t.same(actualVars, expectedVars, `${path} - extracted variables should match (_matchRegexAndPath)`);
          t.same(extractTemplateVariablesFromPath(vector.template, path), expectedVars, `${path} - extracted variables should match (matchTemplateAndPath)`);
        }
      }
    }

    t.end();
  });

  t.test(SUBTEST_NAME + ': insertVariablesIntoTemplate', (t: any) => {
    interface Vector {
      vars: Record<string, string>,
      template: string,
      expected: string,
    }
    let vectors: Vector[] = [
      { vars: {}, template: '', expected: '' },
      { vars: {}, template: '{unmatched}', expected: '{unmatched}' },
      { vars: { extra: 'ok' }, template: '', expected: '' },
      { vars: { extra: 'ok' }, template: '{unmatched}', expected: '{unmatched}' },
      { vars: { category: 'gardening', postId: 'abc' }, template: '/posts/{category}/{postId}.json', expected: '/posts/gardening/abc.json' },
      { vars: { postId: 'abc' }, template: '/posts/{category}/{postId}.json', expected: '/posts/{category}/abc.json' },
      { vars: { category: 'gardening' }, template: '/posts/{category}/{postId}.json', expected: '/posts/gardening/{postId}.json' },
      { vars: { category: 'gardening', postId: '*' }, template: '/posts/{category}/{postId}.json', expected: '/posts/gardening/*.json' },
    ]

    for (let { vars, template, expected } of vectors) {
      let actual = insertVariablesIntoTemplate(vars, template);
      t.same(actual, expected, `${JSON.stringify(vars)}, ${JSON.stringify(template)}`);
    }

    t.end();
  });

  //================================================================================
  // TEMPLATE: USER-FACING API CALLS

  let docPathsForTemplateTest = [
    '/aa',
    '/aaa',
    '/a---a',
    '/aa/aa/aa/aa/aa',
    '/posts',
    '/posts/123.json',
    '/posts/123.txt',
    '/posts/gardening/123.txt',
    '/posts/sailing/123.txt',
  ]
  interface TemplateQueryVector {
    template: string,
    expectedPaths: string[],
    note?: string,
  }
  let templateQueryVectors: TemplateQueryVector[] = [
    {
      template: '',
      expectedPaths: [],
    },
    {
      template: '/posts/{postId}.json',
      expectedPaths: [
        '/posts/123.json',
      ],
    },
    {
      template: '/posts/{postId}.{ext}',
      expectedPaths: [
        '/posts/123.json',
        '/posts/123.txt',
      ],
    },
    {
      template: '/posts/{category}/{postId}.{ext}',
      expectedPaths: [
        '/posts/gardening/123.txt',
        '/posts/sailing/123.txt',
      ],
    },
    {
      template: '/{_1}/{_2}/{_3}/{_4}/{_5}',
      expectedPaths: [
        '/aa/aa/aa/aa/aa',
      ],
    },
    {
      template: '/posts',
      expectedPaths: [
        '/posts',
      ],
    },
    {
      template: '/{oneLayerDeepOnly}',
      expectedPaths: [
        '/aa',
        '/aaa',
        '/a---a',
        '/posts',
      ],
    },
    {
      template: '/a{A}a',
      expectedPaths: [
        '/aa',  // zero-length matches are allowed
        '/aaa',
        '/a---a',
      ],
    },
  ];

  t.test(SUBTEST_NAME + ': queryByTemplateAsyncSync', async (t) => {
    let workspace = '+gardening.abcde';
    let storage = makeStorage(workspace);
    let now = microsecondNow();
    
    for (let path of docPathsForTemplateTest) {
      await storage.set(keypair1, {
        format: 'es.4',
        path: path,
        content: 'content at ' + path,
      });
    }

    for (let vector of templateQueryVectors) {
      let { template, expectedPaths } = vector;
      let docs = await queryByTemplateAsync(storage, template);
      let actualPaths = docs.map(doc => doc.path);

      actualPaths.sort();
      expectedPaths.sort();
      
      let note = vector.note ? ` (${vector.note})` : '';
      t.same(actualPaths, expectedPaths, `template: ${template} should match ${expectedPaths.length} paths.${note}`);
    }

    await storage.close(true);
    t.end();
  });
}