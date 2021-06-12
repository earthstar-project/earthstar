// basic earthstar types
import { WorkspaceAddress } from '../../util/doc-types';
import { IStorageAsync } from '../../storage/storage-types';

// various earthstar classes
import { FormatValidatorEs4 } from '../../format-validators/format-validator-es4';
import { StorageAsync } from '../../storage/storage-async';

// specific drivers
import { CryptoDriverTweetnacl } from '../../crypto/crypto-driver-tweetnacl';
import { StorageDriverAsyncMemory } from '../../storage/storage-driver-async-memory';

// test types
import { StorageTestScenario } from './storage.utils';

// tests
import { runStorageConfigTests } from './storage-config.shared';
import { runStorageTests } from './storage-async.shared';

//================================================================================

let scenarios: StorageTestScenario[] = [
    {
        name: 'StorageDriverAsyncMemory + CryptoDriverTweetnacl',
        cryptoDriver: CryptoDriverTweetnacl,
        persistent: false,
        platforms: { browser: true, node: true, deno: true },
        makeStorage: (ws: WorkspaceAddress): IStorageAsync => {
            let storageDriver = new StorageDriverAsyncMemory(ws);
            return new StorageAsync(ws, FormatValidatorEs4, storageDriver);
        },
    }
]

//================================================================================

for (let scenario of scenarios) {
    runStorageConfigTests(scenario);
    runStorageTests(scenario);
}
