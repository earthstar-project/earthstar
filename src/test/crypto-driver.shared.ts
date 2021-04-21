import t = require('tap');
//t.runOnly = true;

//import tape = require('tape');
//let t = { test: tape };

import {
    stringToBuffer,
    stringToBytes
} from '../util/bytes';
import {
    base32StringToBytes
} from '../base32';
import {
    ICryptoDriver
} from '../types/crypto-types';

//================================================================================

// use this unicode character for testing
let snowmanString = '\u2603';  // ☃ \u2603  [0xe2, 0x98, 0x83] -- 3 bytes
let snowmanBytes = Uint8Array.from([0xe2, 0x98, 0x83]);

//================================================================================

export let runCryptoDriverTests = (driver: ICryptoDriver) => {

    t.test('sha256(bytes | string) --> bytes', (t: any) => {
        let vectors : [Uint8Array | string | Buffer, Uint8Array][] = [
            // input, output
            ['', base32StringToBytes('b4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq')],
            [stringToBytes(''), base32StringToBytes('b4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq')],
            ['abc', base32StringToBytes('bxj4bnp4pahh6uqkbidpf3lrceoyagyndsylxvhfucd7wd4qacwwq')],
            [stringToBytes('abc'), base32StringToBytes('bxj4bnp4pahh6uqkbidpf3lrceoyagyndsylxvhfucd7wd4qacwwq')],
            [snowmanString, base32StringToBytes('bkfsdgyoht3fo6jni32ac3yspk4f2exm4fxy5elmu7lpbdnhum3ga')],
            [snowmanBytes, base32StringToBytes('bkfsdgyoht3fo6jni32ac3yspk4f2exm4fxy5elmu7lpbdnhum3ga')],

            // we're not supposed to feed it Buffers but let's find out what happens when we do.
            [stringToBuffer('abc'), base32StringToBytes('bxj4bnp4pahh6uqkbidpf3lrceoyagyndsylxvhfucd7wd4qacwwq')],
            [stringToBuffer(''), base32StringToBytes('b4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq')],
            [stringToBuffer(snowmanString), base32StringToBytes('bkfsdgyoht3fo6jni32ac3yspk4f2exm4fxy5elmu7lpbdnhum3ga')],
        ];
        for (let [input, expectedResult] of vectors) {
            let actualResult = driver.sha256(input);
            t.ok(actualResult instanceof Uint8Array, 'sha256 outputs a Uint8Array');
            t.same(actualResult.length, 32, 'sha256 outputs 32 bytes');
            t.same(actualResult, expectedResult, `hash of bytes or string: ${JSON.stringify(input)}`)
        }
        t.end();
    });

    t.test('generateKeypairBytes', (t: any) => {
        let keypair = driver.generateKeypairBytes();
        t.ok(keypair.pubkey instanceof Uint8Array, 'keypair has Uint8Array address');
        t.ok(keypair.secret instanceof Uint8Array, 'keypair has Uint8Array secret');
        t.same(keypair.pubkey.length, 32, 'pubkey is 32 bytes long');
        t.same(keypair.secret.length, 32, 'secret is 32 bytes long');
        t.end();
    });

}
