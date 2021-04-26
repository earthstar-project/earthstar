
import {
    cryptoDrivers_browserOnly,
    cryptoDrivers_browserAndUniversal,
    storageDriversAsync_browserOnly,
    storageDriversAsync_browserAndUniversal
} from './test/browser/platform.browser';
import {
    cryptoDrivers_nodeOnly,
    cryptoDrivers_nodeAndUniversal,
    storageDriversAsync_nodeOnly,
    storageDriversAsync_nodeAndUniversal
} from './test/node/platform.node';
import {
    cryptoDrivers_universal,
    storageDriversAsync_universal,
} from './test/universal/platform.universal';

//================================================================================

let logDriverNames = (drivers: any[]) => {
    for (let driver of drivers) {
        console.log(`    ${driver.name}`);
    }
}

console.log();

console.log('CRYPTO DRIVERS');
console.log('  UNIVERSAL:');
logDriverNames(cryptoDrivers_universal);
console.log('  BROWSER ONLY:');
logDriverNames(cryptoDrivers_browserOnly);
console.log('  NODE ONLY:');
logDriverNames(cryptoDrivers_nodeOnly);
console.log();
console.log('  BROWSER + UNIVERSAL:');
logDriverNames(cryptoDrivers_browserAndUniversal);
console.log('  NODE + UNIVERSAL:');
logDriverNames(cryptoDrivers_nodeAndUniversal);

console.log();

console.log('STORAGE DRIVERS');
console.log('  UNIVERSAL:');
logDriverNames(storageDriversAsync_universal);
console.log('  BROWSER ONLY:');
logDriverNames(storageDriversAsync_browserOnly);
console.log('  NODE ONLY:');
logDriverNames(storageDriversAsync_nodeOnly);
console.log();
console.log('  BROWSER + UNIVERSAL:');
logDriverNames(storageDriversAsync_browserAndUniversal);
console.log('  NODE + UNIVERSAL:');
logDriverNames(storageDriversAsync_nodeAndUniversal);

console.log();
