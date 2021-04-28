import { WorkspaceAddress } from '../../util/doc-types';
import { IStorageAsync } from '../../storage/storage-types';

import { StorageAsync } from '../../storage/storage-async';
import { FormatValidatorEs4 } from '../../format-validators/format-validator-es4';

import { Crypto } from '../../crypto/crypto';
import { CryptoDriverTweetnacl } from '../../crypto/crypto-driver-tweetnacl';

import { runStorageTests } from '../shared-test-code/storage-async.shared';

import { storageDriversAsync_browserAndUniversal } from './platform.browser';

for (let storageDriver of storageDriversAsync_browserAndUniversal) {
    // just hardcode this crypto driver since it works on all platforms
    let cryptoDriver = CryptoDriverTweetnacl;

    let storageDriverName = (storageDriver as any).name;
    let cryptoDriverName = (cryptoDriver as any).name;
    let description = `${storageDriverName} + ${cryptoDriverName}`;

    let makeStorage = (ws: WorkspaceAddress): IStorageAsync => {
        let crypto = new Crypto(cryptoDriver);
        let validator = new FormatValidatorEs4(crypto);
        let stDriver = new storageDriver(ws);
        let storage = new StorageAsync(ws, validator, stDriver);
        return storage;
    }

    runStorageTests(description, makeStorage);
}
