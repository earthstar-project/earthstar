import crypto = require('crypto');
import { AuthorKey, Keypair, RawCryptKey } from './types';

let log = console.log;

export const sha256 = (input: string | Buffer): string =>
    // prettier-ignore
    crypto
        .createHash('sha256')
        .update(input)
        .digest()
        .toString('hex');


interface KeypairBuffers {
    public: Buffer,
    secret: Buffer,
}
export const _makeKeypairDerBuffers = () : KeypairBuffers => {
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
export let _derToStringPublic = (buf : Buffer) : RawCryptKey =>
    buf.slice(-32).toString('base64');
export let _derToStringSecret = (buf : Buffer) : RawCryptKey =>
    buf.slice(-32).toString('base64');

export let _derPrefixPublic = Buffer.from('MCowBQYDK2VwAyEA', 'base64');
export let _derPrefixSecret = Buffer.from('MC4CAQAwBQYDK2VwBCIEIA==', 'base64');

// convert base64 encoded string with no sigil to der buffer
export let _stringToDerPublic = (s : RawCryptKey) : Buffer =>
    Buffer.concat([_derPrefixPublic, Buffer.from(s, 'base64')]);
export let _stringToDerSecret = (s : RawCryptKey) : Buffer =>
    Buffer.concat([_derPrefixSecret, Buffer.from(s, 'base64')]);

export const _derToStringKeypair = (bufPair : KeypairBuffers): Keypair => {
    return {
        public: _derToStringPublic(bufPair.public),
        secret: _derToStringSecret(bufPair.secret),
    };
};

export const generateKeypair = (): Keypair =>
    _derToStringKeypair(_makeKeypairDerBuffers());

export const generateFakeKeypair = (): Keypair => ({
    // Generate random strings that look like keys.
    // This is useful for testing, or for use with ValidatorUnsigned.
    // Don't use this in the real world.
    public: 'fakekey' + crypto.randomBytes(32).toString('base64').slice(7),
    secret: 'fakekey' + crypto.randomBytes(32).toString('base64').slice(7),
});

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
