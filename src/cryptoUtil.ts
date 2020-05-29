import mb = require('multibase');
import { Keypair, KeypairBuffers } from './types';

export interface ICrypto {
    sha256(input: string | Buffer) : string ;
    generateKeypair() : Keypair;
    generateKeypairBuffers() : KeypairBuffers;
    sign(keypair : Keypair, msg : string | Buffer) : string;
    verify(publicKey : string, sig : string, msg : string | Buffer) : boolean;
}

let encode = (b : Buffer) : string =>
    mb.encode('base58btc', b).toString().slice(1);  // take off the 'z' prefix that means base58btc
let decode = (s : string) : Buffer =>
    mb.decode('z' + s);
//export let encode = (b : Buffer) : string =>
//    b.toString('base64');
//export let decode = (s : string) : Buffer =>
//    Buffer.from(s, 'base64');

export let encodeSecret = encode;
export let encodeSig = encode;
export let decodeSecret = decode;
export let decodeSig = decode;

export let encodePubkey = (b : Buffer) : string =>
    '@' + encode(b);
export let decodePubkey = (s : string) : Buffer => {
    if (!s.startsWith('@')) {
        console.log('warning: public key does not start with @: ' + s);
    }
    return decode(s.slice(1));
}

export let encodePair = (pair : KeypairBuffers) : Keypair => ({
    public: encodePubkey(pair.public),
    secret: encodeSecret(pair.secret),
});
export let decodePair = (pair : Keypair) : KeypairBuffers => {
    return {
        public: decodePubkey(pair.public),
        secret: decodeSecret(pair.secret),
    }
};

/*
export const generateFakeKeypair = (): Keypair => ({
    // Generate random strings that look like keys.
    // This is useful for testing, or for use with ValidatorUnsigned.
    // Don't use this in the real world.
    public: 'fakekey' + crypto.randomBytes(32).toString('base64').slice(7),
    secret: 'fakekey' + crypto.randomBytes(32).toString('base64').slice(7),
});
*/


/*
export let addSigilToKey = (key: RawCryptKey): AuthorKey => {
    return '@' + key + '.ed25519';
};
export let removeSigilFromKey = (key: AuthorKey): RawCryptKey => {
    if (!key.startsWith('@')) {
        throw 'invalid author key';
    }
    if (!key.endsWith('.ed25519')) {
        throw 'invalid author key';
    }
    return key.slice(1, -8);
};
*/
