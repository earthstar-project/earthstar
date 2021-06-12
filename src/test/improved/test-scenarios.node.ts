// basic earthstar types
import { WorkspaceAddress } from '../../util/doc-types';
import { IStorageDriverAsync } from '../../storage/storage-types';

// specific drivers
import { CryptoDriverTweetnacl } from '../../crypto/crypto-driver-tweetnacl';
import { CryptoDriverNode } from '../../crypto/crypto-driver-node';
import { StorageDriverAsyncMemory } from '../../storage/storage-driver-async-memory';

// test types
import { TestScenario } from './test-scenario-types';

//================================================================================

export let testScenarios: TestScenario[] = [
    {
        name: 'StorageDriverAsyncMemory + CryptoDriverTweetnacl',
        cryptoDriver: CryptoDriverTweetnacl,
        persistent: false,
        platforms: { browser: true, node: true, deno: true },
        makeDriver: (ws: WorkspaceAddress): IStorageDriverAsync =>
            new StorageDriverAsyncMemory(ws),
    },
    {
        name: 'StorageDriverAsyncMemory + CryptoDriverNode',
        cryptoDriver: CryptoDriverNode,
        persistent: false,
        platforms: { browser: true, node: true, deno: true },
        makeDriver: (ws: WorkspaceAddress): IStorageDriverAsync =>
            new StorageDriverAsyncMemory(ws),
    }
]

//================================================================================

//for (let scenario of scenarios) {
//    runStorageDriverTests(scenario);
//    runStorageConfigTests(scenario);
//    runStorageTests(scenario);
//}
//