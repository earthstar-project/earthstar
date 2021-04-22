import {
    AuthorKeypair,
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

//--------------------------------------------------

import {
    log,
    makeDebug,
} from './util/log';
import chalk from 'chalk';
import { Crypto } from './crypto/crypto';
import { CryptoDriverTweetnacl } from './crypto/crypto-driver-tweetnacl';
import { isErr } from './util/errors';
let debugMain = makeDebug(chalk.greenBright('[main]'));
let debugLazyFollower = makeDebug(chalk.magenta(' [main\'s lazy follower]'));
let debugBlockingFollower = makeDebug(chalk.magenta(' [main\'s blocking follower]'));

//================================================================================

let main = async () => {

    log('')
    debugMain('-----------\\')
    debugMain('init crypto driver')
    let crypto = new Crypto(CryptoDriverTweetnacl);
    debugMain('-----------/')

    let workspace = '+gardening.abc';
    let keypair = crypto.generateAuthorKeypair('suzy');
    if (isErr(keypair)) {
        console.error(keypair);
        process.exit(1);
    }
    log('')
    debugMain('-----------\\')
    debugMain('workspace:', workspace);
    debugMain('keypair:', keypair);
    debugMain('-----------/')

    log('')
    debugMain('-----------\\')
    debugMain('init validator')
    let validator = new FormatValidatorEs4(crypto);
    debugMain('-----------/')

    log('')
    debugMain('-----------\\')
    debugMain('init storage driver')
    let storageDriver = new StorageDriverAsyncMemory();
    debugMain('-----------/')

    log('')
    debugMain('-----------\\')
    debugMain('init storage')
    let storage = new StorageAsync(validator, storageDriver);
    debugMain('-----------/')

    log('')
    debugMain('-----------\\')
    let numDocsToWrite = 3;
    debugMain(`setting ${numDocsToWrite} docs`)
    for (let ii = 0; ii < numDocsToWrite; ii++) {
        log('')
        debugMain(`setting #${ii}`);
        let result = await storage.set(keypair, {
            workspace,
            path: `/posts/post-${(''+ii).padStart(4, '0')}.txt`,
            content: `Hello ${ii}`,
        });
        debugMain('    set result', result);
    }
    debugMain('-----------/')

    log('')
    debugMain('-----------\\')
    debugMain('getting all docs');
    debugMain(await storage.getAllDocs());
    debugMain('-----------/')

    log('')
    debugMain('-----------\\')
    debugMain('adding lazy follower');
    let lazyFollower = await addFollower({
        storage: storage,
        onDoc: (doc: Doc | null) => {
            if (doc === null) {
                debugLazyFollower('null -- I have become idle');
            } else {
                debugLazyFollower('got a doc:', doc);
            }
        },
        historyMode: 'latest',
        blocking: false,
        batchSize: 2,
    });
    debugMain('-----------/')

    log('')
    debugMain('-----------\\')
    debugMain('adding blocking follower');
    let blockingFollower = await addFollower({
        storage: storage,
        onDoc: (doc: Doc | null) => {
            if (doc === null) {
                debugBlockingFollower('null -- I have become idle');
            } else {
                debugBlockingFollower('got a doc:', doc);
            }
        },
        historyMode: 'latest',
        blocking: true,
        batchSize: 2,
    });
    debugMain('-----------/')

    log('')
    debugMain('sleep 100');
    log('')
    debugMain('-------------------------------------------')
    debugMain('-------------------------------------------')
    debugMain('-------------------------------------------')
    log('')
    await sleep(100);

    //debug('closing follower');
    //lazyFollower.close();
}
main();



