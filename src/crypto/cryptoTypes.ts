import {
    EncodedSig,
    EncodedHash,
} from '../util/types';

export interface KeypairBuffers {
    pubkey: Buffer,
    secret: Buffer,
}

export interface ILowLevelCrypto {
    sha256base32(input: string | Buffer): EncodedHash;
    generateKeypairBuffers(): KeypairBuffers;
    sign(keypair: KeypairBuffers, msg: string | Buffer): EncodedSig;
    verify(publicKey: Buffer, sig: EncodedSig, msg: string | Buffer): boolean;
}
