import { AuthorKeypair, Doc } from './types/docTypes';

import {
    addFollower,
} from './follower';
import {
    StorageDriverAsyncMemory
} from './storage/storageDriverAsyncMemory';
import {
    StorageAsync as StorageAsync
} from './storage/storageAsync';
import { sleep } from './util/utils';

import {
    log,
    makeDebug,
} from './util/log';
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
    debug('init driver')
    let storageDriver = new StorageDriverAsyncMemory();
    debug('-----------/')

    log('')
    debug('-----------\\')
    debug('init storage')
    let storage = new StorageAsync(storageDriver);
    debug('-----------/')

    log('')
    debug('-----------\\')
    let numDocsToWrite = 3;
    debug(`setting ${numDocsToWrite} docs`)
    for (let ii = 0; ii < numDocsToWrite; ii++) {
        log('')
        debug(`setting #${ii}`);
        let result = await storage.set(keypair, {
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
    debug(await storage.getAllDocs());
    debug('-----------/')

    log('')
    debug('-----------\\')
    debug('adding lazy follower');
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
    debug('-----------/')

    log('')
    debug('-----------\\')
    debug('adding blocking follower');
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



