import { ClassThatImplements } from '../../storage/util-types';
import { ICryptoDriver } from '../../crypto/crypto-types';
import { IStorageDriverAsync } from '../../storage/storage-types';

import { CryptoDriverChloride } from '../../crypto/crypto-driver-chloride';

import {
    cryptoDrivers_universal,
    storageDriversAsync_universal,
} from '../universal/platform.universal';
import { StorageDriverLocalStorage } from '../../storage/storage-driver-local-storage';

//================================================================================

export let cryptoDrivers_browserOnly: ICryptoDriver[] = [
    CryptoDriverChloride,
];

export let storageDriversAsync_browserOnly: ClassThatImplements<IStorageDriverAsync>[] = [
    StorageDriverLocalStorage
];

//================================================================================

export let cryptoDrivers_browserAndUniversal = [
    ...cryptoDrivers_browserOnly,
    ...cryptoDrivers_universal,
]
export let storageDriversAsync_browserAndUniversal = [
    ...storageDriversAsync_browserOnly,
    ...storageDriversAsync_universal,
]

