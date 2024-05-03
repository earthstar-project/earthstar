export interface Ed25519Driver<PrivateKey> {
  generateKeypair(): Promise<{
    publicKey: Uint8Array;
    secretKey: PrivateKey;
  }>;
  sign(
    bytes: Uint8Array,
    secretKey: PrivateKey,
  ): Promise<Uint8Array>;
  verify(
    publicKey: Uint8Array,
    signature: Uint8Array,
    bytes: Uint8Array,
  ): Promise<boolean>;
}
