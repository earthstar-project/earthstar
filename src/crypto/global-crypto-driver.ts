import { ICryptoDriver } from "./crypto-types.ts";
import DefaultCrypto from "./default_driver.ts";

//--------------------------------------------------

import { Logger } from "../util/log.ts";
let logger = new Logger("crypto", "cyan");

//================================================================================

export let GlobalCryptoDriver: ICryptoDriver = DefaultCrypto;

/** Set the crypto driver used for all cryptographic operations. */
export function setGlobalCryptoDriver(driver: ICryptoDriver): void {
  logger.debug(`set global crypto driver: ${(driver as any).name}`);
  GlobalCryptoDriver = driver;
}
