import { AuthorKeypair, Doc } from './types/docTypes';

import {
    Follower,
    addFollower,
} from './follower';
import {
    StorageBackendAsyncMemory
} from './storageBackendAsyncMemory';
import {
    StorageFrontendAsync
} from './storageFrontendAsync';
import { sleep } from './utils';

import {
    log,
    makeDebug,
} from './log';
import chalk from 'chalk';
let debug = makeDebug(chalk.greenBright('[main]'));
let debugLazyFollower = makeDebug(chalk.magenta(' [main\'s lazy follower]'));
let debugBlockingFollower = makeDebug(chalk.magenta(' [main\'s blocking follower]'));

//================================================================================

let main = async () => {

    let workspace = '+gardening.abc';
    let keypair: AuthorKeypair = {
        address: '@suzy.abc',
        secret: 'secret:123',
    };
    log('')
    debug('-----------\\')
    debug('workspace:', workspace);
    debug('keypair:', keypair);
    debug('-----------/')

    log('')
    debug('-----------\\')
    debug('init backend')
    let storageBackend = new StorageBackendAsyncMemory();
    debug('-----------/')

    log('')
    debug('-----------\\')
    debug('init frontend')
    let storageFrontend = new StorageFrontendAsync(storageBackend);
    debug('-----------/')

    log('')
    debug('-----------\\')
    let numDocsToWrite = 3;
    debug(`setting ${numDocsToWrite} docs`)
    for (let ii = 0; ii < numDocsToWrite; ii++) {
        log('')
        debug(`setting #${ii}`);
        let result = await storageFrontend.set(keypair, {
            workspace,
            path: `/posts/post-${(''+ii).padStart(4, '0')}.txt`,
            content: `Hello ${ii}`,
        });
        debug('    set result', result);
    }
    debug('-----------/')

    log('')
    debug('-----------\\')
    debug('getting all docs');
    debug(await storageFrontend.getAllDocs());
    debug('-----------/')

    log('')
    debug('-----------\\')
    debug('adding lazy follower');
    let lazyFollower = await addFollower({
        storageFrontend: storageFrontend,
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
    debug('-----------/')

    log('')
    debug('-----------\\')
    debug('adding blocking follower');
    let blockingFollower = await addFollower({
        storageFrontend: storageFrontend,
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
    debug('-----------/')

    log('')
    debug('sleep 100');
    log('')
    debug('-------------------------------------------')
    debug('-------------------------------------------')
    debug('-------------------------------------------')
    log('')
    await sleep(100);

    //debug('closing follower');
    //lazyFollower.close();
}
main();



