export interface KeypairBytes {
    pubkey: Uint8Array,
    secret: Uint8Array,
}

/**
 * These are the basic crypto primitives we need.
 * There are several implementations which provide this interface,
 * e.g. native Node, Chloride, etc.
 */
export interface ICryptoDriver {
    sha256(input: string | Uint8Array): Uint8Array;
    generateKeypairBytes(): KeypairBytes;
    sign(keypair: KeypairBytes, msg: string | Uint8Array): Uint8Array;
    verify(publicKey: Uint8Array, sig: Uint8Array, msg: string | Uint8Array): boolean;
}
