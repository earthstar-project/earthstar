import { ClassThatImplements } from '../../storage/util-types';
import { ICryptoDriver } from '../../crypto/crypto-types';
import { IStorageDriverAsync } from '../../storage/storage-types';

import { CryptoDriverNode } from '../../crypto/crypto-driver-node';

import {
    cryptoDrivers_universal,
    storageDriversAsync_universal,
} from '../universal/platform.universal';

//================================================================================

export let cryptoDrivers_nodeOnly: ICryptoDriver[] = [
];
if (process && process.version >= 'v12') {
    // the node crypto driver only works in node 12 or higher
    cryptoDrivers_nodeOnly.push(CryptoDriverNode);
}

export let storageDriversAsync_nodeOnly: ClassThatImplements<IStorageDriverAsync>[] = [
];

//================================================================================

export let cryptoDrivers_nodeAndUniversal = [
    ...cryptoDrivers_nodeOnly,
    ...cryptoDrivers_universal,
]
export let storageDriversAsync_nodeAndUniversal = [
    ...storageDriversAsync_nodeOnly,
    ...storageDriversAsync_universal,
]

