import { isDeno, isNode } from "https://deno.land/x/which_runtime@0.2.0/mod.ts";

// specific crypto drivers
import { CryptoDriverNoble } from "../crypto/crypto-driver-noble.ts";
import { CryptoDriverNode } from "../crypto/crypto-driver-node.js";
import { CryptoDriverChloride } from "../crypto/crypto-driver-chloride.ts";

// specific storage drivers
import { StorageDriverAsyncMemory } from "../storage/storage-driver-async-memory.ts";
import { StorageDriverLocalStorage } from "../storage/storage-driver-local-storage.ts";
import { StorageDriverIndexedDB } from "../storage/storage-driver-indexeddb.ts";

// test types
import { CryptoScenario, TestScenario } from "./test-scenario-types.ts";

// A version of test scenario without crypto specified yet.
type JustStorageScenario = Omit<TestScenario, "cryptoDriver">;

// ----------------------------------------------------------
// Storage only scenarios, grouped by capability

const universalStorageScenarios: JustStorageScenario[] = [
    {
        name: "StorageDriverAsyncMemory",
        persistent: false,
        makeDriver: (ws) => new StorageDriverAsyncMemory(ws),
    },
];

const browserStorageScenarios: JustStorageScenario[] = [
    {
        name: "StorageDriverLocalStorage",
        persistent: true,
        makeDriver: (ws) => new StorageDriverLocalStorage(ws),
    },
];

const browserOnlyStorageScenarios: JustStorageScenario[] = [
    {
        name: "StorageDriverIndexedDB",
        persistent: true,
        makeDriver: (ws) => new StorageDriverIndexedDB(ws),
    },
];

// ----------------------------------------------------------
// Crypto scenarios, grouped by platform

const universalCryptoScenarios: CryptoScenario[] = [
    {
        name: "CryptoDriverNoble",
        driver: CryptoDriverNoble,
    },
];

const nodeCryptoScenarios: CryptoScenario[] = [
    {
        name: "CryptoDriverNode",
        driver: CryptoDriverNode,
    },
    {
        name: "CryptoDriverChloride",
        driver: CryptoDriverChloride,
    },
];

// ----------------------------------------------------------
// Zip them all together into platforms

function makeScenarios(
    storageScenarios: JustStorageScenario[],
    cryptoScenarios: CryptoScenario[],
): TestScenario[] {
    return storageScenarios.flatMap((storageScenario) => {
        return cryptoScenarios.map((cryptoScenario) => ({
            ...storageScenario,
            name: `${storageScenario.name} + ${cryptoScenario.name}`,
            cryptoDriver: cryptoScenario.driver,
        }));
    });
}

const browserScenarios = makeScenarios(
    [
        ...universalStorageScenarios,
        ...browserStorageScenarios,
        ...browserOnlyStorageScenarios,
    ],
    [...universalCryptoScenarios],
);

const denoScenarios = makeScenarios(
    [
        ...universalStorageScenarios,
        ...browserStorageScenarios,
    ],
    [...universalCryptoScenarios],
);

const nodeScenarios = makeScenarios(
    [
        ...universalStorageScenarios,
    ],
    [...universalCryptoScenarios, ...nodeCryptoScenarios],
);

function getScenarios() {
    if (isDeno) {
        return denoScenarios;
    } else if (isNode) {
        return nodeScenarios;
    }

    return browserScenarios;
}

function getCryptoScenarios() {
    if (isDeno) {
        return [...universalCryptoScenarios];
    } else if (isNode) {
        return [...universalCryptoScenarios, ...nodeCryptoScenarios];
    }

    return [...universalCryptoScenarios];
}

//================================================================================

export const testScenarios: TestScenario[] = getScenarios();
export const testCryptoScenarios: CryptoScenario[] = getCryptoScenarios();
