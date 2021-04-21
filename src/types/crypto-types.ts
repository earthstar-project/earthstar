export interface KeypairBuffers {
    pubkey: Buffer,
    secret: Buffer,
}

/**
 * These are the basic crypto primitives we need.
 * There are several implementations which provide this interface,
 * e.g. native Node, Chloride, etc.
 */
export interface ICryptoDriver {
    sha256(input: string | Buffer): Buffer;
    generateKeypairBuffers(): KeypairBuffers;
    sign(keypair: KeypairBuffers, msg: string | Buffer): Buffer;
    verify(publicKey: Buffer, sig: Buffer, msg: string | Buffer): boolean;
}
