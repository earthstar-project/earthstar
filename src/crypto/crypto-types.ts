import {
    AuthorAddress,
    AuthorKeypair,
    Base32String,
} from '../util/doc-types';
import {
    ValidationError,
} from '../util/errors';

export interface KeypairBytes {
    pubkey: Uint8Array,
    secret: Uint8Array,
}

/**
 * The higher-level crypto functions.
 * These all handle base32-encoded strings.
 */
export interface ICrypto {
    sha256base32(input: string | Uint8Array): Base32String;
    generateAuthorKeypair(name: string): AuthorKeypair | ValidationError;
    sign(keypair: AuthorKeypair, msg: string | Uint8Array): Base32String | ValidationError;
    verify(authorAddress: AuthorAddress, sig: Base32String, msg: string | Uint8Array): boolean;
    checkAuthorKeypairIsValid(keypair: AuthorKeypair): true | ValidationError;
}

/**
 * These are the basic crypto primitives we need.
 * There are several implementations which provide this interface,
 * e.g. native Node, Chloride, etc.
 * These all handle Uint8Arrays (bytes)
 */
export interface ICryptoDriver {
    sha256(input: string | Uint8Array): Uint8Array;
    generateKeypairBytes(): KeypairBytes;
    sign(keypairBytes: KeypairBytes, msg: string | Uint8Array): Uint8Array;
    verify(publicKey: Uint8Array, sig: Uint8Array, msg: string | Uint8Array): boolean;
}
