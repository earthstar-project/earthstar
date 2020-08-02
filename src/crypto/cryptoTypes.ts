import {
    EncodedSig,
    EncodedHash,
} from '../util/types';

export interface KeypairBuffers {
    pubkey: Buffer,
    secret: Buffer,
}

export interface ILowLevelCrypto {
    sha256(input: string | Buffer): EncodedHash;  // lower-case hex
    generateKeypairBuffers(): KeypairBuffers;
    sign(keypair: KeypairBuffers, msg: string | Buffer): EncodedSig;  // base32
    verify(publicKey: Buffer, sig: EncodedSig, msg: string | Buffer): boolean;
}
