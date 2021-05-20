import { CryptoDriverTweetnacl } from './crypto-driver-tweetnacl';
import { ICryptoDriver } from './crypto-types';

//--------------------------------------------------

import { Logger } from '../util/log';
let logger = new Logger('crypto', 'cyanBright');

//================================================================================

export let GlobalCryptoDriver: ICryptoDriver = CryptoDriverTweetnacl;

export let setGlobalCryptoDriver = (driver: ICryptoDriver): void => {
    logger.debug(`set global crypto driver: ${(driver as any).name}`);
    GlobalCryptoDriver = driver;
}
