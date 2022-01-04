import { CryptoDriverNoble } from "./crypto-driver-noble.ts";
import { ICryptoDriver } from "./crypto-types.ts";

//--------------------------------------------------

import { Logger } from "../util/log.ts";
let logger = new Logger("crypto", "cyanBright");

//================================================================================

export let GlobalCryptoDriver: ICryptoDriver = CryptoDriverNoble;

export let setGlobalCryptoDriver = (driver: ICryptoDriver): void => {
  logger.debug(`set global crypto driver: ${(driver as any).name}`);
  GlobalCryptoDriver = driver;
};
