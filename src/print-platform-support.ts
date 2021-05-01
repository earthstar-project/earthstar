import chalk from 'chalk';
import {
    cryptoDrivers_browserOnly,
    storageDriversAsync_browserOnly,
} from './test/browser/platform.browser';
import {
    cryptoDrivers_nodeOnly,
    storageDriversAsync_nodeOnly,
} from './test/node/platform.node';
import {
    cryptoDrivers_universal,
    storageDriversAsync_universal,
} from './test/universal/platform.universal';

//================================================================================


type Platform = 'universal' | 'browser' | 'node' | '?';
let logDriverAndPlatform = (driver: any, platform: Platform) => {
    let driverName: string = driver.name;
    let platformPadded = platform.padStart(10, ' ');

    let platformColor = chalk.visible;
    let driverColor = chalk.visible;
    if      (platform === 'universal') { platformColor = chalk.green; }
    else if (platform === 'browser'  ) { platformColor = chalk.magentaBright; }
    else if (platform === 'node'     ) { platformColor = chalk.yellowBright; }
    if      (driverName.startsWith('Crypto') ) { driverColor = chalk.blueBright; }
    else if (driverName.startsWith('Storage')) { driverColor = chalk.cyanBright; }

    console.log(`    ${platformColor(platformPadded)} - ${driverColor(driverName)}`);
}
let log = (msg: string = '') => console.log(chalk.white(msg));

log();

log('BY DRIVER TYPE');
log();

log('  CRYPTO');
cryptoDrivers_universal.forEach(driver => logDriverAndPlatform(driver, 'universal'));
cryptoDrivers_browserOnly.forEach(driver => logDriverAndPlatform(driver, 'browser'));
cryptoDrivers_nodeOnly.forEach(driver => logDriverAndPlatform(driver, 'node'));
log();

log('  STORAGE');
storageDriversAsync_universal.forEach(driver => logDriverAndPlatform(driver, 'universal'));
storageDriversAsync_browserOnly.forEach(driver => logDriverAndPlatform(driver, 'browser'));
storageDriversAsync_nodeOnly.forEach(driver => logDriverAndPlatform(driver, 'node'));
log();

log();

log('EVERYTHING AVAILABLE IN...');
log();

log('  BROWSER');
cryptoDrivers_universal.forEach(driver => logDriverAndPlatform(driver, 'universal'));
cryptoDrivers_browserOnly.forEach(driver => logDriverAndPlatform(driver, 'browser'));
storageDriversAsync_universal.forEach(driver => logDriverAndPlatform(driver, 'universal'));
storageDriversAsync_browserOnly.forEach(driver => logDriverAndPlatform(driver, 'browser'));
log();

log('  NODE');
cryptoDrivers_universal.forEach(driver => logDriverAndPlatform(driver, 'universal'));
cryptoDrivers_nodeOnly.forEach(driver => logDriverAndPlatform(driver, 'node'));
storageDriversAsync_universal.forEach(driver => logDriverAndPlatform(driver, 'universal'));
storageDriversAsync_nodeOnly.forEach(driver => logDriverAndPlatform(driver, 'node'));
log();
