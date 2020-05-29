import crypto = require('crypto');
import { Keypair, RawCryptKey, KeypairBuffers } from '../src/types';

const _makeKeypairDerBuffers = () : KeypairBuffers => {
    // Typescript has outdated definitions, doesn't know about ed25519
    // so fight it with "as any"
    let pair = crypto.generateKeyPairSync(
        'ed25519' as any,
        {
            publicKeyEncoding: {
                format: 'der',
                type: 'spki',
            },
            privateKeyEncoding: {
                format: 'der',
                type: 'pkcs8',
            },
        } as any
    );
    // Typescript thinks these are strings, but they're Buffers.
    return {
        public: (pair.publicKey as any as Buffer),
        secret: (pair.privateKey as any as Buffer),
    };
};

// convert der buffer to base64 encoded string with no sigil
let _derToStringPublic = (buf : Buffer) : RawCryptKey =>
    buf.slice(-32).toString('base64');
let _derToStringSecret = (buf : Buffer) : RawCryptKey =>
    buf.slice(-32).toString('base64');

let _derPrefixPublic = Buffer.from('MCowBQYDK2VwAyEA', 'base64');
let _derPrefixSecret = Buffer.from('MC4CAQAwBQYDK2VwBCIEIA==', 'base64');

// convert base64 encoded string with no sigil to der buffer
let _stringToDerPublic = (s : RawCryptKey) : Buffer =>
    Buffer.concat([_derPrefixPublic, Buffer.from(s, 'base64')]);
let _stringToDerSecret = (s : RawCryptKey) : Buffer =>
    Buffer.concat([_derPrefixSecret, Buffer.from(s, 'base64')]);

const _derToStringKeypair = (bufPair : KeypairBuffers): Keypair => {
    return {
        public: _derToStringPublic(bufPair.public),
        secret: _derToStringSecret(bufPair.secret),
    };
};

export const generateKeypair = (): Keypair =>
    _derToStringKeypair(_makeKeypairDerBuffers());

export let sign = (input: string | Buffer, secret: RawCryptKey): string => {
    if (typeof input === 'string') { input = Buffer.from(input, 'utf8'); }
    // prettier-ignore
    return crypto.sign(
            null,
            input,
            {
                key: _stringToDerSecret(secret),
                format: 'der',
                type: 'pkcs8',
            }
        )
        .toString('base64') + '.sig.ed25519';
}

export let isSignatureValid = (input: string | Buffer, sig: string, pubkey: RawCryptKey): boolean => {
    if (!sig.endsWith('.sig.ed25519')) {
        return false;
    }
    if (sig.length !== 100) { return false; }
    sig = sig.slice(0, -12);  // remove .sig.ed25519
    if (typeof input === 'string') { input = Buffer.from(input, 'utf8'); }
    try {
        // prettier-ignore
        return crypto.verify(
            null,
            Buffer.from(input),
            {
                key: _stringToDerPublic(pubkey),
                format: 'der',
                type: 'spki',
            } as any,
            Buffer.from(sig, 'base64'),
        );
    } catch (e) {
        return false;
    }
};