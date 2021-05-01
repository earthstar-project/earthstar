import { ClassThatImplements } from '../../storage/util-types';
import { ICryptoDriver } from '../../crypto/crypto-types';
import { IStorageDriverAsync } from '../../storage/storage-types';

import { CryptoDriverTweetnacl } from '../../crypto/crypto-driver-tweetnacl';

import { StorageDriverAsyncMemory } from '../../storage/storage-driver-async-memory';

//================================================================================

export let cryptoDrivers_universal: ICryptoDriver[] = [
    CryptoDriverTweetnacl,
];

export let storageDriversAsync_universal: ClassThatImplements<IStorageDriverAsync>[] = [
    StorageDriverAsyncMemory,
];

