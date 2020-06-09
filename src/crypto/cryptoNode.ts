import crypto = require('crypto');
import { Keypair, KeypairBuffers } from '../util/types';
import { ICrypto, encodePair, encodeSig, decodeSecret, decodePubkey, decodeSig } from './cryptoUtil';

const _generateKeypairDerBuffers = () : KeypairBuffers => {
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

let _shortenDer = (k: KeypairBuffers) : KeypairBuffers => ({
    public: k.public.slice(-32),
    secret: k.secret.slice(-32),
});
let _derPrefixPublic = Buffer.from('MCowBQYDK2VwAyEA', 'base64');
let _derPrefixSecret = Buffer.from('MC4CAQAwBQYDK2VwBCIEIA==', 'base64');
let _lengthenDerPublic = (b : Buffer) : Buffer => 
    Buffer.concat([_derPrefixPublic, b]);
let _lengthenDerSecret = (b : Buffer) : Buffer => 
    Buffer.concat([_derPrefixSecret, b]);

export const CryptoNode : ICrypto = class {
    static sha256(input: string | Buffer): string {
        return crypto.createHash('sha256').update(input).digest().toString('hex');
    }
    static generateKeypair() : Keypair {
        return encodePair(CryptoNode.generateKeypairBuffers());
    }
    static generateKeypairBuffers() : KeypairBuffers {
        return _shortenDer(_generateKeypairDerBuffers());
    };
    static sign(keypair : Keypair, msg : string | Buffer) : string {
        if (typeof msg === 'string') { msg = Buffer.from(msg, 'utf8'); }
        // prettier-ignore
        return encodeSig(crypto.sign(
            null,
            msg,
            {
                key: _lengthenDerSecret(decodeSecret(keypair.secret)),
                format: 'der',
                type: 'pkcs8',
            }
        ));
    }
    static verify(publicKey : string, sig : string, msg : string | Buffer) : boolean {
        if (typeof msg === 'string') { msg = Buffer.from(msg, 'utf8'); }
        try {
            // prettier-ignore
            return crypto.verify(
                null,
                msg,
                {
                    key: _lengthenDerPublic(decodePubkey(publicKey)),
                    format: 'der',
                    type: 'spki',
                } as any,
                decodeSig(sig),
            );
        } catch (e) {
            return false;
        }
    }
};