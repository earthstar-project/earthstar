
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

    t.end();
  });

  t.test(SUBTEST_NAME + ': insertVariablesIntoTemplate', (t: any) => {

    t.end();
  });

  //================================================================================
  // TEMPLATE: USER-FACING API CALLS

  t.test(SUBTEST_NAME + ': queryByTemplateAsyncSync', async (t) => {

    t.end();
  });
}