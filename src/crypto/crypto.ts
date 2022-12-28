import {
  AuthorAddress,
  Base32String,
  ShareAddress,
} from "../util/doc-types.ts";
import { AuthorKeypair, ICrypto, ShareKeypair } from "./crypto-types.ts";
import { isErr, ValidationError } from "../util/errors.ts";

import { randomId } from "../util/misc.ts";
import { base32BytesToString, base32StringToBytes } from "./base32.ts";
import { decodeKeypairToBytes, isAuthorKeypair } from "./keypair.ts";
import {
  assembleAuthorAddress,
  assembleShareAddress,
  checkAuthorIsValid,
  checkShareIsValid,
  parseAuthorOrShareAddress,
} from "../core-validators/addresses.ts";

import { GlobalCryptoDriver } from "./global-crypto-driver.ts";

//--------------------------------------------------

import { Logger } from "../util/log.ts";
let logger = new Logger("crypto", "cyan");

//================================================================================

/** Higher-level crypto functions. Mostly used for generating new author and share keypairs. */
export const Crypto: ICrypto = class {
  /** Do a sha256 hash, then return the output bytes encoded as base32. */
  static async sha256base32(
    input: string | Uint8Array,
  ): Promise<Base32String> {
    const b32 = await GlobalCryptoDriver.sha256(input);

    return base32BytesToString(b32);
  }

  static updatableSha256() {
    return GlobalCryptoDriver.updatableSha256();
  }

  /**
   * Generate a new author keypair — a keypair of public and private keys as strings encoded in base32.
   *
   * NOTE: this will return a different keypair every time, even if the name is the same.
   * (Names are not unique.)
   *
   * Returns a ValidationError if the name doesn't follow the rules.
   *
   * @param shortname A 4-character nickname to make the address easier to remember and identify.
   */
  static async generateAuthorKeypair(
    shortname: string,
  ): Promise<AuthorKeypair | ValidationError> {
    logger.debug(`generateAuthorKeypair("${shortname}")`);
    const keypairBytes = await GlobalCryptoDriver
      .generateKeypairBytes();
    const keypairFormatted = {
      address: assembleAuthorAddress(
        shortname,
        base32BytesToString(keypairBytes.pubkey),
      ),
      secret: base32BytesToString(keypairBytes.secret),
    };
    // Make sure it's valid (correct length, etc).  return error if invalid.
    const err = checkAuthorIsValid(keypairFormatted.address);
    if (isErr(err)) return err;
    return keypairFormatted;
  }

  /**
   * Generate a new share keypair — a keypair of public and private keys as strings encoded in base32.
   *
   * NOTE: this will return a different keypair every time, even if the name is the same.
   * (Names are not unique.)
   *
   * Returns a ValidationError if the name doesn't follow the rules.
   *
   * @param name A free-form name to identify the share.
   */
  static async generateShareKeypair(
    name: string,
  ): Promise<ShareKeypair | ValidationError> {
    logger.debug(`generateAuthorKeypair("${name}")`);
    const keypairBytes = await GlobalCryptoDriver
      .generateKeypairBytes();
    const keypairFormatted = {
      shareAddress: assembleShareAddress(
        name,
        base32BytesToString(keypairBytes.pubkey),
      ),
      secret: base32BytesToString(keypairBytes.secret),
    };
    // Make sure it's valid (correct length, etc).  return error if invalid.
    const err = checkShareIsValid(keypairFormatted.shareAddress);
    if (isErr(err)) return err;
    return keypairFormatted;
  }

  /**
   * Sign a message using an Earthstar keypair.
   * Return a signature as base32 string.
   *
   * Can return a ValidationError if the keypair is bad or something goes unexpectedly wrong with signing.
   */
  static async sign(
    keypair: AuthorKeypair | ShareKeypair,
    msg: string | Uint8Array,
  ): Promise<Base32String | ValidationError> {
    logger.debug(`sign`);
    try {
      const keypairBytes = decodeKeypairToBytes(keypair);
      if (isErr(keypairBytes)) return keypairBytes;

      const signed = await GlobalCryptoDriver.sign(keypairBytes, msg);

      return base32BytesToString(signed);
    } catch (err) {
      /* istanbul ignore next */
      return new ValidationError(
        "unexpected error while signing: " + err.message,
      );
    }
  }

  /**
   * Check if a ed25519 signature is valid.
   *
   * This returns false on any kind of failure:
   *   * bad author address format
   *   * bad signature base32 format
   *   * signature base32 format is valid but signature itself is invalid
   *   * unexpected failure from crypto library
   */
  static verify(
    address: AuthorAddress | ShareAddress,
    sig: Base32String,
    msg: string | Uint8Array,
  ): Promise<boolean> {
    logger.debug(`verify`);
    try {
      const parsed = parseAuthorOrShareAddress(address);

      if (isErr(parsed)) return Promise.resolve(false);
      return GlobalCryptoDriver.verify(
        base32StringToBytes(parsed.pubkey),
        base32StringToBytes(sig),
        msg,
      );
    } catch {
      // catch any unexpected errors
      return Promise.resolve(false);
    }
  }

  /**
   * Check if an ed25519 keypair is valid, e.g. does the secret match the pubkey.
   *
   * Returns...
   * - true on success (format is correct, and secret matches pubkey)
   * - a ValidationError if the secret does not match the pubkey.
   * - a ValidationError if the author address or secret are not validly formatted strings.
   * - a ValidationError if anything else goes wrong
   */
  static async checkKeypairIsValid(
    keypair: AuthorKeypair | ShareKeypair,
  ): Promise<true | ValidationError> {
    // We check if the secret matches the pubkey by signing something and then validating the signature.
    // However, key generation is deterministic, so it would be more direct to just do this:
    //
    //     let pubkeyBytes = LowLevelCrypto.generateKeypairBytes(base32StringtoBytes(keypair.secret))
    //     then check if pubkeyBytes matches keypair.address
    //
    // ...but only some of the cryptodrivers let you give a seed for keypair generation.
    // ...so this signature trick will work for now.
    logger.debug(`checkAuthorKeypairIsValid`);

    const address = isAuthorKeypair(keypair)
      ? keypair.address
      : keypair.shareAddress;

    try {
      if (
        typeof address !== "string" ||
        typeof keypair.secret !== "string"
      ) {
        return new ValidationError(
          "address and secret must be strings",
        );
      }
      const parseErr = parseAuthorOrShareAddress(address);
      if (isErr(parseErr)) return parseErr;

      const msg = "a test message to sign. " + randomId();
      const sig = await this.sign(keypair, msg);
      if (isErr(sig)) return sig;

      const isValid = await this.verify(address, sig, msg);
      if (isValid === false) {
        return new ValidationError("pubkey does not match secret");
      }

      return true;
    } catch (err) {
      return new ValidationError(
        "unexpected error in checkAuthorKeypairIsValid: " + err.message,
      );
    }
  }
};
