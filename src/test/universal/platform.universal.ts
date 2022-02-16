import { ClassThatImplements } from "../../storage/util-types.ts";
import { ICryptoDriver } from "../../crypto/crypto-types.ts";
import { IStorageDriverAsync } from "../../storage/storage-types.ts";

import { CryptoDriverTweetnacl } from "../../crypto/crypto-driver-tweetnacl.ts";
import { CryptoDriverNoble } from "../../crypto/crypto-driver-noble.ts";

import { StorageDriverAsyncMemory } from "../../storage/storage-driver-async-memory.ts";

//================================================================================

export let cryptoDrivers_universal: ICryptoDriver[] = [
    CryptoDriverTweetnacl,
    CryptoDriverNoble,
];

export let storageDriversAsync_universal: ClassThatImplements<
    IStorageDriverAsync
>[] = [
    StorageDriverAsyncMemory,
];
