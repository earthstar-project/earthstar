import {
  assembleIdentityAddress,
  assembleShareAddress,
  checkIdentityIsValid,
  checkShareIsValid,
  parseIdentityOrShareAddress,
} from "../core_validators/addresses.ts";
import { decodeBase32, encodeBase32 } from "../encoding/base32.ts";
import { Base32String } from "../encoding/types.ts";
import { isErr, ValidationError } from "../util/errors.ts";
import { decodeKeypairAddressToBytes } from "./keypair.ts";
import {
  CryptoDriver,
  IdentityAddress,
  IdentityKeypair,
  OwnedNamespaceKeypair,
  ShareAddress,
} from "./types.ts";
import { crypto } from "../../deps.ts";

export class Crypto<PrivateKey> {
  constructor(readonly driver: CryptoDriver<PrivateKey>) {
  }

  async hash(
    input: Uint8Array | ReadableStream<Uint8Array>,
  ): Promise<Base32String> {
    const hashBytes = await crypto.subtle.digest("SHA-256", input);

    return encodeBase32(new Uint8Array(hashBytes));
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
  async generateIdentityKeypair(
    shortname: string,
  ): Promise<IdentityKeypair<PrivateKey> | ValidationError> {
    // Validate shortname.

    const { publicKey, privateKey } = await this.driver.generateKeypair();

    // Encode the pubkey and secret.
    const pubkeyBase32 = encodeBase32(publicKey);

    const keypair = {
      identityAddress: assembleIdentityAddress(shortname, pubkeyBase32),
      privateKey,
    };

    const isValidRes = checkIdentityIsValid(keypair.identityAddress);

    if (isErr(isValidRes)) {
      return isValidRes;
    }

    return keypair;
  }

  generateCommunalNamespaceAddress(
    name: string,
  ): ShareAddress {
    let pubkey = crypto.getRandomValues(new Uint8Array(32));

    while ((pubkey[pubkey.byteLength - 1] & 0x1) === 0x1) {
      pubkey = crypto.getRandomValues(new Uint8Array(32));
    }

    return assembleShareAddress(true, name, encodeBase32(pubkey));
  }

  /**
   * Generate a new *owned* share keypair — a keypair of public and private keys as strings encoded in base32.
   *
   * NOTE: this will return a different keypair every time, even if the name is the same.
   * (Names are not unique.)
   *
   * Returns a ValidationError if the name doesn't follow the rules.
   *
   * @param name A freeform name to identify the share.
   */
  async generateOwnedNamespaceKeypair(
    name: string,
  ): Promise<OwnedNamespaceKeypair<PrivateKey> | ValidationError> {
    const { publicKey, privateKey } = await this.driver.generateKeypair();

    let candidatePubKey = publicKey;
    let candidatePrivateKey = privateKey;

    while ((candidatePubKey[candidatePubKey.byteLength - 1] & 0x1) !== 0x1) {
      const { publicKey, privateKey } = await this.driver.generateKeypair();

      candidatePubKey = publicKey;
      candidatePrivateKey = privateKey;
    }

    // Encode the pubkey and secret.
    const pubkeyBase32 = encodeBase32(candidatePubKey);

    const keypair = {
      shareAddress: assembleShareAddress(false, name, pubkeyBase32),
      privateKey: candidatePrivateKey,
    };

    const isValidRes = checkShareIsValid(keypair.shareAddress);

    if (isErr(isValidRes)) {
      return isValidRes;
    }

    return keypair;
  }

  /**
   * Sign a message using an Earthstar keypair.
   * Return a signature as base32 string.
   *
   * Can return a ValidationError if the keypair is bad or something goes unexpectedly wrong with signing.
   */
  async sign(
    keypair: OwnedNamespaceKeypair<PrivateKey> | IdentityKeypair<PrivateKey>,
    bytes: Uint8Array,
  ): Promise<Base32String | ValidationError> {
    try {
      const signed = await this.driver.sign(bytes, keypair.privateKey);

      return encodeBase32(signed);
    } catch (err) {
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
  verify(
    address: IdentityAddress | ShareAddress,
    sig: Base32String,
    bytes: Uint8Array,
  ): Promise<boolean> {
    try {
      const parsed = parseIdentityOrShareAddress(address);

      if (isErr(parsed)) return Promise.resolve(false);
      return this.driver.verify(
        decodeBase32(parsed.pubkey),
        decodeBase32(sig),
        bytes,
      );
    } catch {
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
  async checkKeypairIsValid(
    keypair: IdentityKeypair<PrivateKey> | OwnedNamespaceKeypair<PrivateKey>,
  ): Promise<true | ValidationError> {
    // We check if the secret matches the pubkey by signing something and then validating the signature.
    // However, key generation is deterministic, so it would be more direct to just do this:
    //
    //     let pubkeyBytes = LowLevelCrypto.generateKeypairBytes(base32StringtoBytes(keypair.secret))
    //     then check if pubkeyBytes matches keypair.address
    //
    // ...but only some of the cryptodrivers let you give a seed for keypair generation.
    // ...so this signature trick will work for now.

    const pubkeyBytes = decodeKeypairAddressToBytes(keypair);
    if (isErr(pubkeyBytes)) return pubkeyBytes;

    try {
      const randomBytes = crypto.getRandomValues(new Uint8Array(8));
      const sig = await this.driver.sign(randomBytes, keypair.privateKey);
      if (isErr(sig)) return sig;

      const isValid = await this.driver.verify(
        pubkeyBytes,
        sig,
        randomBytes,
      );
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
}
