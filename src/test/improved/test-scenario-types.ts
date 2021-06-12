import { WorkspaceAddress } from '../../util/doc-types';
import { ICryptoDriver } from '../../crypto/crypto-types';
import { IStorageDriverAsync } from '../../storage/storage-types';

export interface TestScenario {
    // name of test, to show in list of tests
    name: string,

    // which crypto driver to use
    cryptoDriver: ICryptoDriver,

    // is this storage scenario expected to persist (to disk, etc)?
    persistent: boolean,

    // which platforms should this test run on?
    platforms: {
        browser: boolean,
        node: boolean,
        deno: boolean,
    }

    // in here you will instantiate a StorageDriver and then
    // use it to instantiate a Storage:
    makeDriver: (ws: WorkspaceAddress) => IStorageDriverAsync;
}
