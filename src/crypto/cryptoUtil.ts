import mb = require('multibase');
import { Keypair, KeypairBuffers } from '../util/types';

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