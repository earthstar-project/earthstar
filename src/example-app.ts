import {
    isErr,
} from './util/errors';
import {
    sleep
} from './util/misc';
import {
    FormatValidatorEs4,
} from './format-validators/format-validator-es4';
import {
    StorageDriverAsyncMemory,
} from './storage/storage-driver-async-memory';
import {
    StorageAsync,
} from './storage/storage-async';
import {
    Crypto,
} from './crypto/crypto';
import {
    CryptoDriverTweetnacl,
} from './crypto/crypto-driver-tweetnacl';
import {
    QueryFollower,
} from './storage/query-follower';

//--------------------------------------------------

import {
    LogLevel,
    Logger,
    setDefaultLogLevel,
    setLogLevel
} from './util/log';

let loggerMain = new Logger('main', 'whiteBright');
let loggerBusEvents = new Logger('main storage bus events', 'white');
let loggerQueryFollowerCallbacks1 = new Logger('main query follower 1 callback', 'red');
let loggerQueryFollowerCallbacks2 = new Logger('main query follower 2 callback', 'red');

setDefaultLogLevel(LogLevel.Debug);
setLogLevel('main', LogLevel.Debug);

//================================================================================

let main = async () => {

    let workspace = '+gardening.abc';

    // setup
    loggerMain.blank();
    loggerMain.blank()
    loggerMain.blank()
    loggerMain.info('-----------\\')
    loggerMain.info('setup')
    loggerMain.info('workspace =', workspace);
    loggerMain.info('instantiate crypto, validator, storageDriver, and storage')
    let crypto = new Crypto(CryptoDriverTweetnacl);
    let validator = new FormatValidatorEs4(crypto);
    let storageDriver = new StorageDriverAsyncMemory(workspace);
    let storage = new StorageAsync(workspace, validator, storageDriver);
    loggerMain.info('generate a keypair')
    let keypair = crypto.generateAuthorKeypair('suzy');
    if (isErr(keypair)) {
        console.error(keypair);
        process.exit(1);
    }
    loggerMain.info('    keypair =', keypair);
    loggerMain.info('-----------/')

    loggerMain.blank()
    loggerMain.blank()
    loggerMain.blank()
    loggerMain.info('-----------\\')
    loggerMain.info('adding a queryFollower');
    // add a QueryFollower
    let qf1 = new QueryFollower(
        storage,
        {
            historyMode: 'all', orderBy: 'localIndex ASC',
            //startAt: { localIndex: 1 },
            //filter: { path: '/posts/post-0001.txt' },
        },
        async (doc): Promise<void> => {
            loggerQueryFollowerCallbacks1.debug('got a doc', doc);
        }
    );
    qf1.bus.on('caught-up', () => loggerQueryFollowerCallbacks1.debug('caught-up'));
    qf1.bus.on('close', () => loggerQueryFollowerCallbacks1.debug('close'));
    loggerMain.info('hatching it');
    await qf1.hatch();
    loggerMain.info('-----------/')

    // write some docs
    loggerMain.blank()
    loggerMain.blank()
    loggerMain.blank()
    loggerMain.info('-----------\\')
    let numDocsToWrite = 2;
    loggerMain.info(`setting ${numDocsToWrite} docs`)
    for (let ii = 0; ii < numDocsToWrite; ii++) {
        loggerMain.blank()
        loggerMain.info(`setting #${ii}`);
        let result = await storage.set(keypair, {
            format: 'es.4',
            workspace,
            path: `/posts/post-${(''+ii).padStart(4, '0')}.txt`,
            content: `Hello ${ii}`,
        });
        loggerMain.info('    set result', result);
    }
    loggerMain.info('-----------/')

    // get all docs
    loggerMain.blank()
    loggerMain.blank()
    loggerMain.blank()
    loggerMain.info('-----------\\')
    loggerMain.info('getting all docs');
    let allDocs = await storage.getAllDocs();
    for (let ii = 0; ii < allDocs.length; ii++) {
        loggerMain.info(`doc ${ii+1} of ${allDocs.length}:`, allDocs[ii]);
    }
    loggerMain.info('-----------/')

    // add another QueryFollower
    // now that we have some docs, this will have to catch up
    loggerMain.blank()
    loggerMain.blank()
    loggerMain.blank()
    loggerMain.info('-----------\\')
    loggerMain.info('adding a queryFollower');
    let qf2 = new QueryFollower(
        storage,
        {
            historyMode: 'all', orderBy: 'localIndex ASC',
            //startAt: { localIndex: 1 },
            //filter: { path: '/posts/post-0000.txt' },
        },
        async (doc): Promise<void> => {
            loggerQueryFollowerCallbacks2.debug('got a doc', doc);
        }
    );
    qf2.bus.on('caught-up', () => loggerQueryFollowerCallbacks2.debug('caught-up'));
    qf2.bus.on('close', () => loggerQueryFollowerCallbacks2.debug('close'));
    loggerMain.info('hatching it');
    await qf2.hatch();
    loggerMain.info('-----------/')

    // sleep
    loggerMain.blank()
    loggerMain.blank()
    loggerMain.blank()
    loggerMain.info('---------------------------------------')
    loggerMain.info('-----------------------------------------')
    loggerMain.info('-------------------------------------------')
    loggerMain.info('sleep 100');
    loggerMain.blank()
    loggerMain.blank()
    loggerMain.blank()
    await sleep(100);
    loggerMain.blank()
    loggerMain.blank()
    loggerMain.blank()
    loggerMain.info('done sleeping 100');
    loggerMain.info('-------------------------------------------')
    loggerMain.info('-----------------------------------------')
    loggerMain.info('---------------------------------------')

    storage.bus.on('willClose', async () => {
        loggerBusEvents.debug('storage willClose... sleeping 1 second...');
        await sleep(1000);
        loggerBusEvents.debug('...storage willClose done.');
    }, { mode: 'blocking' });

    storage.bus.on('didClose', async () => {
        loggerBusEvents.debug('storage didClose... sleeping 1 second...');
        await sleep(1000);
        loggerBusEvents.debug('...storage didClose done.');
    }, { mode: 'nonblocking' });

    loggerMain.blank()
    loggerMain.blank()
    loggerMain.blank()
    loggerMain.info('closing storage');
    loggerMain.info('-------------------------------------------')
    await storage.close();
    loggerMain.info('-------------------------------------------')
    loggerMain.blank()
    loggerMain.blank()
    loggerMain.blank()

}
main();



