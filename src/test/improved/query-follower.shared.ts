
import t = require('tap');
import { onFinishOneTest } from '../browser-run-exit';
import { doesNotThrow, throws } from '../test-utils';
//t.runOnly = true;

import { AuthorKeypair, WorkspaceAddress } from '../../util/doc-types';
import { IStorageAsync, LiveQueryEvent } from '../../storage/storage-types';
import { Query } from '../../query/query-types';
import { isErr } from '../../util/errors';
import { microsecondNow, sleep } from '../../util/misc';
import { Crypto } from '../../crypto/crypto';
import { GlobalCryptoDriver } from '../../crypto/global-crypto-driver';
import { FormatValidatorEs4 } from '../../format-validators/format-validator-es4';
import { StorageAsync } from '../../storage/storage-async';

import { TestScenario } from './test-scenario-types';

//================================================================================

import {
    Logger, LogLevel, setLogLevel,
} from '../../util/log';
import { QueryFollower } from '../../query-follower/query-follower';
let loggerTest = new Logger('test', 'whiteBright');
let loggerTestCb = new Logger('test cb', 'white');
let J = JSON.stringify;

//setLogLevel('test', LogLevel.Debug);
//setLogLevel('test cb', LogLevel.Debug);

//================================================================================

export let runQueryFollowerTests = (scenario: TestScenario) => {

    let TEST_NAME = 'QueryFollower tests';
    let SUBTEST_NAME = scenario.name;

    // Boilerplate to help browser-run know when this test is completed.
    // When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function.
    /* istanbul ignore next */ 
    (t.test as any)?.onFinish?.(() => onFinishOneTest(TEST_NAME, SUBTEST_NAME));

    let makeStorage = (ws: WorkspaceAddress): IStorageAsync => {
        let driver = scenario.makeDriver(ws);
        return new StorageAsync(ws, FormatValidatorEs4, driver);
    }

    t.test(SUBTEST_NAME + ': query rules', async (t: any) => {
        let initialCryptoDriver = GlobalCryptoDriver;

        let workspace = '+gardening.abcde';
        let storage = makeStorage(workspace);
        let author1 = Crypto.generateAuthorKeypair('onee');
        if (isErr(author1)) { t.ok(false, 'generate author failed'); await storage.close(true); t.end(); return }

        interface Vector { query: Query, isValid: Boolean, note?: string };
        let vectors: Vector[] = [
            { isValid: true,  query: { historyMode: 'all',    orderBy: 'localIndex ASC' } },
            { isValid: true,  query: { historyMode: 'all',    orderBy: 'localIndex ASC', startAfter: { localIndex: 123 }  } },
            { isValid: true,  query: { historyMode: 'all',    orderBy: 'localIndex ASC', filter: { path: '/foo/' }  } },

            { isValid: false, query: { historyMode: 'latest', orderBy: 'localIndex ASC' } },
            { isValid: false, query: { historyMode: 'all',    orderBy: 'localIndex DESC' } },
            { isValid: false, query: { historyMode: 'all',    orderBy: 'localIndex ASC', limit: 123 } },
            { isValid: false, query: {                        orderBy: 'localIndex ASC' } },
            { isValid: false, query: { historyMode: 'all',                              } },
            { isValid: false, query: {                                                  } },
        ];

        for (let { query, isValid, note } of vectors) {
            let makeFollower = async () => {
                let qf = new QueryFollower(storage, query);
            };
            if (isValid) { doesNotThrow(t, makeFollower, 'valid:   ' + (note || J(query))); }
            else         { throws(      t, makeFollower, 'invalid: ' + (note || J(query))); }
        }

        await storage.close(true);
        t.same(initialCryptoDriver, GlobalCryptoDriver, `GlobalCryptoDriver has not changed unexpectedly.  started as ${(initialCryptoDriver as any).name}, ended as ${(GlobalCryptoDriver as any).name}`)
        t.end();
    });

    t.test(SUBTEST_NAME + ': basics', async (t: any) => {
        let initialCryptoDriver = GlobalCryptoDriver;

        loggerTest.debug('begin');

        let logs: string[] = ['-begin'];

        let workspace = '+gardening.abcde';
        let storage = makeStorage(workspace);

        let keypair1 = await Crypto.generateAuthorKeypair('aaaa');
        let keypair2 = await Crypto.generateAuthorKeypair('bbbb');
        if (isErr(keypair1) || isErr(keypair2)) {
            t.ok(false, 'error making keypair');
            t.end();
            return;
        }

        //--------------------------------------------------
        loggerTest.debug('testing disallowed live queries');
        await throws(t, async () => {
            let query: Query = {
                historyMode: 'latest',
                orderBy: 'localIndex ASC',
                startAfter: { localIndex: -1 }, // start at beginning
            }
            let qf = new QueryFollower(storage, query);
        }, 'liveQuery does not allow historyMode latest');
        await throws(t, async () => {
            let query: Query = {
                historyMode: 'all',
                orderBy: 'localIndex DESC',
                startAfter: { localIndex: -1 }, // start at beginning
            }
            let qf = new QueryFollower(storage, query);
        }, 'liveQuery requires orderBy localIndex ASC');
        await throws(t, async () => {
            let query: Query = {
                historyMode: 'all',
                orderBy: 'localIndex ASC',
                startAfter: { localIndex: -1 }, // start at beginning
                limit: 123,
            }
            let qf = new QueryFollower(storage, query);
        }, 'liveQuery may not have a limit');


        //--------------------------------------------------
        // write initial docs, before we begin the query follower

        let now = microsecondNow();
        loggerTest.debug('write doc 0');
        await storage.set(keypair1, {
            format: 'es.4',
            path: '/apple',
            content: 'crunchy0',
            timestamp: now + 0,
        });

        loggerTest.debug('write doc 1');
        await storage.set(keypair1, {
            format: 'es.4',
            path: '/cherry',
            content: 'crispy1',
            timestamp: now + 1,
        });

        //--------------------------------------------------
        // set up the query follower

        let query: Query = {
            historyMode: 'all',
            orderBy: 'localIndex ASC',
            //filter: { path: '/apple' },
            startAfter: { localIndex: -1 }, // start at beginning
        }
        let qf = new QueryFollower(storage, query);
        t.same(qf.state(), 'new', 'state should be "new" before hatching');

        //--------------------------------------------------
        // subscribe to query follower events

        qf.bus.on(async (event: LiveQueryEvent) => {
            loggerTestCb.debug('>>>>>>>>>>>>>>>>', event);
            if (event.kind && event.kind === 'existing') {
                logs.push(`> ${event.kind}: ${event.doc.path} = ${event.doc.content} (index ${event.doc._localIndex})`);
            } else if (event.kind && event.kind === 'success') {
                logs.push(`> ${event.kind}: ${event.doc.path} = ${event.doc.content} (index ${event.doc._localIndex})`);
            } else if (event.kind) {
                logs.push(`> ${event.kind}`);
            } else {
                logs.push(`> ???`);
            }
        });

        //--------------------------------------------------
        // kick things off

        await qf.hatch();
        t.same(qf.state(), 'live', 'state should be "live" after hatching');

        // sleep so query follower can catch up
        await sleep(50);

        loggerTest.debug('write doc 2');
        await storage.set(keypair2, {
            format: 'es.4',
            path: '/apple',
            content: 'juicy2',
            timestamp: now + 2,
        });

        loggerTest.debug('write doc 3');
        await storage.set(keypair2, {
            format: 'es.4',
            path: '/banana',
            content: 'yellow3',
            timestamp: now + 3,
        });

        loggerTest.debug('sleep so query follower can catch up');
        await sleep(50);

        loggerTest.debug('write doc 4');
        await storage.set(keypair2, {
            format: 'es.4',
            path: '/peach',
            content: 'orange4',
            timestamp: now + 4,
        });

        loggerTest.debug('close the storage');
        await storage.close(true);

        loggerTest.debug('sleep so didClose has time to happen');
        await sleep(50);

        logs.push('-end');
        let expectedLogs = [
            '-begin',
            '> existing: /apple = crunchy0 (index 0)',
            '> existing: /cherry = crispy1 (index 1)',
            '> idle',  // caught up
            '> success: /apple = juicy2 (index 2)',
            '> success: /banana = yellow3 (index 3)',
            '> success: /peach = orange4 (index 4)',
            '> willClose',
            '> didClose',
            '> queryFollowerDidClose',
            '-end',
        ];
        t.same(logs, expectedLogs, 'logs match');

        t.same(initialCryptoDriver, GlobalCryptoDriver, `GlobalCryptoDriver has not changed unexpectedly.  started as ${(initialCryptoDriver as any).name}, ended as ${(GlobalCryptoDriver as any).name}`)
        t.end();
    });

    t.test(SUBTEST_NAME + ': fuzz test', async (t: any) => {
        let initialCryptoDriver = GlobalCryptoDriver;

        loggerTest.debug('begin');

        let logs: string[] = ['-begin'];

        let workspace = '+gardening.abcde';
        let storage = makeStorage(workspace);

        let keypair1 = await Crypto.generateAuthorKeypair('aaaa');
        let keypair2 = await Crypto.generateAuthorKeypair('bbbb');
        if (isErr(keypair1) || isErr(keypair2)) {
            t.ok(false, 'error making keypair');
            t.end();
            return;
        }

        // set a bunch of sequential documents
        let addDocs = async(storage: IStorageAsync, keypair: AuthorKeypair, startAt: number, endAt: number): Promise<void> => {
            let ii = startAt;
            while (ii <= endAt) {
                await storage.set(keypair, {
                    format: 'es.4',
                    path: '/test/' + Math.random(),
                    content: '' + ii,
                    timestamp: microsecondNow(),
                });
                ii++;
            }
        } 

        // add some initial documents...
        await addDocs(storage, keypair1, 0, 20);

        // set up a query follower...
        let itemsFound: number[] = [];
        let qf = new QueryFollower(storage, {
            historyMode: 'all',
            orderBy: 'localIndex ASC',
            startAfter: { localIndex: -1 },
        });
        qf.bus.on((event: LiveQueryEvent) => {
            if (event.kind === 'existing' || event.kind === 'success') {
                itemsFound.push(+ event.doc.content);
            }
        });
        // let it catch up...
        await qf.hatch();

        // add more docs
        await addDocs(storage, keypair1, 21, 40);
        await sleep(30);
        await addDocs(storage, keypair1, 41, 50);

        // and close the storage.
        await storage.close(true);

        let expectedItemsFound = [...Array(51).keys()];
        t.same(itemsFound, expectedItemsFound, 'each item should occur once, in order');

        t.same(initialCryptoDriver, GlobalCryptoDriver, `GlobalCryptoDriver has not changed unexpectedly.  started as ${(initialCryptoDriver as any).name}, ended as ${(GlobalCryptoDriver as any).name}`)
        t.end();
    });

    // TODO: try closing the queryfollower from inside its own bus event handler -- this might cause a deadlock

}