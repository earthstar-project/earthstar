import { AuthorKeypair, Doc } from './types/docTypes';

import {
    Follower
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
    debugWithTag
} from './log';
import chalk from 'chalk';
let debug = makeDebug(chalk.greenBright('[main]'));
let debugFollower = makeDebug(chalk.green(' [main\'s follower]'));

//================================================================================

let main = async () => {

    let workspace = '+gardening.abc';
    let keypair: AuthorKeypair = {
        address: '@suzy.abc',
        secret: 'secret:123',
    };
    log('')
    debug('workspace:', workspace);
    debug('keypair:', keypair);

    log('')
    let storageBackend = new StorageBackendAsyncMemory();

    log('')
    let storageFrontend = new StorageFrontendAsync(storageBackend);

    //log('')
    //debug('adding follower');
    //let follower = new Follower({
    //    storageFrontend: storageFrontend,
    //    onDoc: (doc: Doc) => {
    //        debugFollower(doc);
    //    },
    //    historyMode: 'latest',
    //});

    for (let ii = 0; ii < 1; ii++) {
        log('')
        debug(`setting #${ii}`);
        let result = await storageFrontend.set(keypair, {
            workspace,
            path: '/about/displayName.txt',
            content: `Suzy ${ii}`,
        });
        debug('    set result', result);
    }

    log('')
    debug('getting all docs');
    debug(await storageFrontend.getAllDocs());

    log('')
    debug('sleep 100');
    await sleep(100);

    //debug('closing follower');
    //follower.close();

}
main();



