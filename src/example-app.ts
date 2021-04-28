import {
    Doc,
} from './util/doc-types';
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
    addFollower,
} from './storage/follower';
import { Crypto } from './crypto/crypto';
import { CryptoDriverTweetnacl } from './crypto/crypto-driver-tweetnacl';
import { isErr } from './util/errors';

//--------------------------------------------------

import {
    LogLevel,
    Logger,
    setDefaultLogLevel,
    setLogLevel
} from './util/log';

let loggerMain = new Logger('main', 'whiteBright');
let loggerLazyFollower = new Logger("main's lazy follower", 'magentaBright');
let loggerBlockingFollower = new Logger("main's blocking follower", 'magentaBright');

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

    // write some docs
    loggerMain.blank()
    loggerMain.blank()
    loggerMain.blank()
    loggerMain.info('-----------\\')
    let numDocsToWrite = 1;
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

    //if (Math.random() < 10) { process.exit(0); } // hack

    // add lazy follower
    loggerMain.blank()
    loggerMain.blank()
    loggerMain.blank()
    loggerMain.info('-----------\\')
    loggerMain.info('adding lazy follower');
    let lazyFollower = await addFollower({
        storage: storage,
        onDoc: (doc: Doc | null) => {
            if (doc === null) {
                loggerLazyFollower.debug('null -- I have become idle');
            } else {
                loggerLazyFollower.debug('got a doc:', doc);
            }
        },
        historyMode: 'latest',
        blocking: false,
        batchSize: 2,
    });
    loggerMain.info('-----------/')

    // add blocking follower
    loggerMain.blank()
    loggerMain.blank()
    loggerMain.blank()
    loggerMain.info('-----------\\')
    loggerMain.info('adding blocking follower');
    let blockingFollower = await addFollower({
        storage: storage,
        onDoc: (doc: Doc | null) => {
            if (doc === null) {
                loggerBlockingFollower.debug('null -- I have become idle');
            } else {
                loggerBlockingFollower.debug('got a doc:', doc);
            }
        },
        historyMode: 'latest',
        blocking: true,
        batchSize: 2,
    });
    loggerMain.info('-----------/')

    // sleep
    loggerMain.blank()
    loggerMain.blank()
    loggerMain.blank()
    loggerMain.info('sleep 100');
    loggerMain.info('---------------------------------------')
    loggerMain.info('-----------------------------------------')
    loggerMain.info('-------------------------------------------')
    loggerMain.blank()
    loggerMain.blank()
    loggerMain.blank()
    await sleep(100);
    loggerMain.blank()
    loggerMain.blank()
    loggerMain.blank()
    loggerMain.info('-------------------------------------------')
    loggerMain.info('-----------------------------------------')
    loggerMain.info('---------------------------------------')
    loggerMain.info('done sleeping 100');

    loggerMain.blank()
    loggerMain.blank()
    loggerMain.blank()
    loggerMain.info('closing storage');
    storage.close();

    //debug('closing follower');
    //lazyFollower.close();
}
main();



