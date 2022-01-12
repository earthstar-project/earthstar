import { ICryptoDriver, KeypairBytes } from "./crypto-types.ts";
import { base32StringToBytes } from "./base32.ts";

//--------------------------------------------------

import { Logger } from "../util/log.ts";
let logger = new Logger("crypto-driver-fake", "cyan");

//================================================================================
/**
 * DO NOT use this in production.
 *
 * This crypto driver is FAKE - it doesn't do anything useful.
 * It returns garbage data and does not verify signatures.
 * But it's fast, so use it when you're benchmarking other parts of the system
 * like Storage drivers.
 *
 * DO NOT use this in production.
 */
export const CryptoDriverFake: ICryptoDriver = class {
    static async sha256(input: string | Uint8Array): Promise<Uint8Array> {
        return base32StringToBytes(
            "bwnu6vkidepzqwaoww6yvhdhsyhd5elkvrjp5wqdktaupuxziuvxa",
        );
    }
    static async generateKeypairBytes(): Promise<KeypairBytes> {
        logger.debug("generateKeypairBytes (FAKE)");
        return {
            pubkey: base32StringToBytes(
                "b3utxcw7aiebdyue2gcx44uiqmxbsm2tc45deglh4s2jyonvgfvja",
            ),
            secret: base32StringToBytes(
                "bwnu6vkidepzqwaoww6yvhdhsyhd5elkvrjp5wqdktaupuxziuvxa",
            ),
        };
    }
    static async sign(
        keypairBytes: KeypairBytes,
        msg: string | Uint8Array,
    ): Promise<Uint8Array> {
        logger.debug("sign (FAKE)");
        return base32StringToBytes(
            "bjljalsg2mulkut56anrteaejvrrtnjlrwfvswiqsi2psero22qqw7am34z3u3xcw7nx6mha42isfuzae5xda3armky5clrqrewrhgca",
        );
    }
    static async verify(
        publicKey: Uint8Array,
        sig: Uint8Array,
        msg: string | Uint8Array,
    ): Promise<boolean> {
        logger.debug("verify (FAKE)");
        return true;
    }
};
