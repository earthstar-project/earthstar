import { ClassThatImplements } from '../../storage/util-types';
import { ICryptoDriver } from '../../crypto/crypto-types';
import { IStorageDriverAsync } from '../../storage/storage-types';

import { CryptoDriverTweetnacl } from '../../crypto/crypto-driver-tweetnacl';
import { CryptoDriverNoble} from '../../crypto/crypto-driver-noble';

import { StorageDriverAsyncMemory } from '../../storage/storage-driver-async-memory';

//================================================================================

export let cryptoDrivers_universal: ICryptoDriver[] = [
    CryptoDriverTweetnacl,
    CryptoDriverNoble,
];

export let storageDriversAsync_universal: ClassThatImplements<IStorageDriverAsync>[] = [
    StorageDriverAsyncMemory,
];

