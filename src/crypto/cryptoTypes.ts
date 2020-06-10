export interface KeypairBuffers {
    pubkey: Buffer,
    secret: Buffer,
}

export interface ILowLevelCrypto {
    sha256(input: string | Buffer) : string ;  // hex
    generateKeypairBuffers() : KeypairBuffers;
    sign(keypair : KeypairBuffers, msg : string | Buffer) : string;
    verify(publicKey : Buffer, sig : string, msg : string | Buffer) : boolean;
}
