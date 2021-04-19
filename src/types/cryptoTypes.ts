import { Base32String } from './docTypes';

export interface KeypairBuffers {
    pubkey: Buffer,
    secret: Buffer,
}

/**
 * These are the basic crypto primitives we need.
 * There are several implementations which provide this interface,
 * e.g. native Node, Chloride, etc.
 */
export interface ILowLevelCrypto {
    sha256(input: string | Buffer): Buffer;
    generateKeypairBuffers(): KeypairBuffers;
    sign(keypair: KeypairBuffers, msg: string | Buffer): Base32String;
    verify(publicKey: Buffer, sig: Base32String, msg: string | Buffer): boolean;
}
