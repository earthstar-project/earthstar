import { WorkspaceAddress } from '../../util/doc-types';
import { IStorageAsync } from '../../storage/storage-types';

import { StorageAsync } from '../../storage/storage-async';
import { FormatValidatorEs4 } from '../../format-validators/format-validator-es4';

import { CryptoDriverTweetnacl } from '../../crypto/crypto-driver-tweetnacl';

import { runStorageTests } from '../shared-test-code/storage-async.shared';

import { storageDriversAsync_browserAndUniversal } from './platform.browser';
import { GlobalCryptoDriver, setGlobalCryptoDriver } from '../../crypto/global-crypto-driver';

for (let storageDriver of storageDriversAsync_browserAndUniversal) {
    // just hardcode this crypto driver since it works on all platforms
    setGlobalCryptoDriver(CryptoDriverTweetnacl);

    let storageDriverName = (storageDriver as any).name;
    let cryptoDriverName = (GlobalCryptoDriver as any).name;
    let description = `${storageDriverName} + ${cryptoDriverName}`;

    let makeStorage = (ws: WorkspaceAddress): IStorageAsync => {
        let stDriver = new storageDriver(ws);
        let storage = new StorageAsync(ws, FormatValidatorEs4, stDriver);
        return storage;
    }

    runStorageTests(description, makeStorage);
}
