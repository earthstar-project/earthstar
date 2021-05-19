import { WorkspaceAddress } from '../../util/doc-types';

import { StorageAsync } from '../../storage/storage-async';
import { FormatValidatorEs4 } from '../../format-validators/format-validator-es4';

import { CryptoDriverTweetnacl } from '../../crypto/crypto-driver-tweetnacl';

import { runQueryFollowerTests } from '../shared-test-code/query-follower.shared';

import { storageDriversAsync_nodeAndUniversal } from './platform.node';
import { IStorageAsync } from '../../storage/storage-types';
import { setGlobalCryptoDriver } from '../../crypto/crypto';

for (let storageDriver of storageDriversAsync_nodeAndUniversal) {
    // just hardcode this crypto driver since it works on all platforms
    let cryptoDriver = CryptoDriverTweetnacl;
    setGlobalCryptoDriver(cryptoDriver);

    let storageDriverName = (storageDriver as any).name;
    let cryptoDriverName = (cryptoDriver as any).name;
    let description = `${storageDriverName} + ${cryptoDriverName}`;

    let makeStorage = (ws: WorkspaceAddress): IStorageAsync => {
        let validator = new FormatValidatorEs4();
        let stDriver = new storageDriver(ws);
        let storage = new StorageAsync(ws, validator, stDriver);
        return storage;
    }

    runQueryFollowerTests(description, makeStorage);
}
