import {
    EncodedSig,
} from '../util/types';

export interface KeypairBuffers {
    pubkey: Buffer,
    secret: Buffer,
}

/**
 * These are the basic crypto primitives we need.
 * There are several implementations which implement this interface,
 * e.g. native Node, Chloride, etc.
 */
export interface ILowLevelCrypto {
    sha256(input: string | Buffer): Buffer;
    generateKeypairBuffers(): KeypairBuffers;
    sign(keypair: KeypairBuffers, msg: string | Buffer): EncodedSig;
    verify(publicKey: Buffer, sig: EncodedSig, msg: string | Buffer): boolean;
}
