import { CryptoDriverNoble } from './crypto-driver-noble';
import { ICryptoDriver } from './crypto-types';

//--------------------------------------------------

import { Logger } from '../util/log';
let logger = new Logger('crypto', 'cyanBright');

//================================================================================

export let GlobalCryptoDriver: ICryptoDriver = CryptoDriverNoble;

export let setGlobalCryptoDriver = (driver: ICryptoDriver): void => {
    logger.debug(`set global crypto driver: ${(driver as any).name}`);
    GlobalCryptoDriver = driver;
}
