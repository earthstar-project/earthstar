import t = require('tap');
// Boilerplate to help browser-run know when this test is completed (see browser-run.ts)
// When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function..
declare let window: any;
if ((t.test as any).onFinish) {
    (t.test as any).onFinish(() => window.onFinish('crypto'));
}

import {
    AuthorKeypair
} from '../util/doc-types';
import {
    isErr,
    ValidationError,
} from '../util/errors';

import {
    stringToBytes
} from '../util/bytes';
import {
    decodeAuthorKeypairToBytes,
    encodeAuthorKeypairToStrings,
} from '../crypto/keypair';
import {
    checkAuthorKeypairIsValid,
    generateAuthorKeypair,
    sha256base32,
    sign,
    verify,
} from '../crypto/crypto';
import { sleep } from '../util/misc';

//================================================================================

// use this unicode character for testing
let snowmanString = '\u2603';  // ☃ \u2603  [0xe2, 0x98, 0x83] -- 3 bytes
let snowmanBytes = Uint8Array.from([0xe2, 0x98, 0x83]);

//================================================================================

t.test('sha256 of strings', (t: any) => {
    let vectors : [string, string][] = [
        // input, output
        ['', 'b4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq'],
        ['abc', 'bxj4bnp4pahh6uqkbidpf3lrceoyagyndsylxvhfucd7wd4qacwwq'],
        [snowmanString, 'bkfsdgyoht3fo6jni32ac3yspk4f2exm4fxy5elmu7lpbdnhum3ga'],
    ];
    for (let [input, output] of vectors) {
        t.equal(sha256base32(input), output, `hash of ${JSON.stringify(input)}`);
    }
    t.end();
});

t.test('sha256 of bytes', (t: any) => {
    let vectors : [Uint8Array, string][] = [
        // input, output
        [stringToBytes(''), 'b4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq'],
        [Uint8Array.from([]), 'b4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq'],
        [stringToBytes('abc'), 'bxj4bnp4pahh6uqkbidpf3lrceoyagyndsylxvhfucd7wd4qacwwq'],
        [Uint8Array.from([97, 98, 99]), 'bxj4bnp4pahh6uqkbidpf3lrceoyagyndsylxvhfucd7wd4qacwwq'],
        // snowman in utf-8
        [snowmanBytes, 'bkfsdgyoht3fo6jni32ac3yspk4f2exm4fxy5elmu7lpbdnhum3ga'],
    ];
    for (let [input, output] of vectors) {
        t.equal(sha256base32(input), output, `hash of bytes: ${JSON.stringify(input)}`)
    }
    t.end();
});

t.test('generateAuthorKeypair', (t: any) => {
    t.ok(isErr(generateAuthorKeypair('abc')), 'error when author shortname is too short');
    t.ok(isErr(generateAuthorKeypair('abcde')), 'error when author shortname is too long');
    t.ok(isErr(generateAuthorKeypair('TEST')), 'error when author shortname is uppercase');
    t.ok(isErr(generateAuthorKeypair('1abc')), 'error when author shortname starts with a number');
    t.ok(isErr(generateAuthorKeypair('abc-')), 'error when author shortname has dashes');
    t.ok(isErr(generateAuthorKeypair('abc.')), 'error when author shortname has a dot');
    t.ok(isErr(generateAuthorKeypair('abc ')), 'error when author shortname has a space');
    t.ok(isErr(generateAuthorKeypair('')), 'error when author shortname is empty');

    let keypair = generateAuthorKeypair('ok99');
    if (isErr(keypair)) {
        t.ok(false, 'should have succeeded but instead was an error: ' + keypair);
        t.end();
        return;
    } else {
        t.equal(typeof keypair.address, 'string', 'keypair has address');
        t.equal(typeof keypair.secret, 'string', 'keypair has secret');
        t.ok(keypair.address.startsWith('@ok99.'), 'keypair.address starts with @ok99.');
        t.ok(keypair.secret.startsWith('b'), 'keypair.secret starts with "b"');
    }

    let keypair2 = generateAuthorKeypair('ok99');
    if (isErr(keypair2)) {
        t.ok(false, 'should have succeeded but instead was an error: ' + keypair2);
    } else {
        t.notSame(keypair.address, keypair2.address, 'keypair generation is not deterministic (pubkeys differ)');
        t.notSame(keypair.secret, keypair2.secret, 'keypair generation is not deterministic (secrets differ)');
    }

    t.end();
});

t.test('authorKeypairIsValid', (t: any) => {
    let keypair1 = generateAuthorKeypair('onee');
    let keypair2 = generateAuthorKeypair('twoo');
    if (isErr(keypair1)) { 
        t.ok(false, 'keypair1 was not generated successfully');
        t.end();
        return;
    }
    if (isErr(keypair2)) { 
        t.ok(false, 'keypair2 was not generated successfully');
        t.end();
        return;
    }

    t.equal(checkAuthorKeypairIsValid(keypair1), true, 'keypair1 is valid');
    t.notSame(keypair1.secret, keypair2.secret, 'different keypairs have different secrets');

    t.ok(isErr(checkAuthorKeypairIsValid({
        address: '',
        secret: keypair1.secret,
    })), 'empty address makes keypair invalid');

    t.ok(isErr(checkAuthorKeypairIsValid({
        address: keypair1.address,
        secret: '',
    })), 'empty secret makes keypair invalid');

    t.ok(isErr(checkAuthorKeypairIsValid({
        address: keypair1.address + 'a',
        secret: keypair1.secret,
    })), 'adding char to pubkey makes keypair invalid');

    t.ok(isErr(checkAuthorKeypairIsValid({
        address: keypair1.address,
        secret: keypair1.secret + 'a'
    })), 'adding char to secret makes keypair invalid');

    t.ok(isErr(checkAuthorKeypairIsValid({
        address: keypair1.address.slice(0, -8) + 'aaaaaaaa',
        secret: keypair1.secret,
    })), 'altering pubkey makes keypair invalid');

    t.ok(isErr(checkAuthorKeypairIsValid({
        address: keypair1.address,
        secret: keypair1.secret.slice(0, -8) + 'aaaaaaaa',
    })), 'altering secret makes keypair invalid');

    t.ok(isErr(checkAuthorKeypairIsValid({
        address: keypair1.address,
        secret: keypair2.secret,
    })), 'mixing address and secret from 2 different keypairs is invalid');

    t.ok(isErr(checkAuthorKeypairIsValid({
        address: keypair1.address,
        secret: keypair1.secret.slice(0, -1) + '1',  // 1 is not a valid b32 character
    })), 'invalid b32 char in address makes keypair invalid');

    t.ok(isErr(checkAuthorKeypairIsValid({
        address: keypair1.address,
        secret: keypair1.secret.slice(0, -1) + '1',  // 1 is not a valid b32 character
    })), 'invalid b32 char in secret makes keypair invalid');

    t.ok(isErr(checkAuthorKeypairIsValid({
        secret: keypair1.secret,
    } as any)), 'missing address is invalid');

    t.ok(isErr(checkAuthorKeypairIsValid({
        address: keypair1.address,
    } as any)), 'missing secret is invalid');

    t.end();
});

t.test('encode/decode author keypair: from bytes to string and back', (t: any) => {
    let shortname = 'test';
    let keypair = generateAuthorKeypair(shortname);
    if (isErr(keypair)) {
        t.ok(false, 'keypair 1 is an error');
        t.end();
        return;
    }
    let keypairBytes = decodeAuthorKeypairToBytes(keypair);
    if (isErr(keypairBytes)) {
        t.ok(false, 'keypairBytes is an error');
        t.end();
        return;
    };
    let keypair2 = encodeAuthorKeypairToStrings(shortname, keypairBytes);
    if (isErr(keypair2)) {
        t.ok(false, 'keypair 2 is an error');
        t.end();
        return;
    }
    let keypairBytes2 = decodeAuthorKeypairToBytes(keypair);
    if (isErr(keypairBytes2)) {
        t.ok(false, 'keypairBytes2 is an error');
        t.end();
        return;
    };

    t.same(keypair, keypair2, 'keypair encoding/decoding roundtrip matched (strings)');
    t.same(keypairBytes, keypairBytes2, 'keypair encoding/decoding roundtrip matched (bytes)');

    keypair.secret = 'x';
    let err1 = decodeAuthorKeypairToBytes(keypair);
    t.ok(isErr(err1), 'decodeAuthorKeypairToBytes returns an error if the secret is bad base32 (no leading "b")');

    keypair.secret = 'b1';
    let err2 = decodeAuthorKeypairToBytes(keypair);
    t.ok(isErr(err2), 'decodeAuthorKeypairToBytes returns an error if the secret is bad base32 (invalid base32 character)');

    // we test for base32-too-short later in another test

    t.end();
});

t.test('signatures', (t: any) => {
    let input = 'abc';

    let keypair = generateAuthorKeypair('test') as AuthorKeypair;
    let keypair2 = generateAuthorKeypair('fooo') as AuthorKeypair;
    if (isErr(keypair) || isErr(keypair2)) {
        t.ok(false, 'keypair generation error');
        t.end(); return;
    }

    let sig = sign(keypair, input);
    let sig2 = sign(keypair2, input);
    if (isErr(sig)) {
        t.ok(false, 'signature error ' + sig);
        t.end(); return;
    }
    if (isErr(sig2)) {
        t.ok(false, 'signature error ' + sig2);
        t.end(); return;
    }

    t.ok(verify(keypair.address, sig, input), 'real signature is valid');

    // ways a signature should fail
    t.notOk(verify(keypair.address, 'bad sig', input), 'garbage signature is not valid');
    t.notOk(verify(keypair.address, sig2, input), 'signature from another key is not valid');
    t.notOk(verify(keypair.address, sig, 'different input'), 'signature is not valid with different input');
    t.notOk(verify('@bad.address', sig, input), 'invalid author address = invalid signature, return false');

    // determinism
    t.equal(sign(keypair, 'aaa'), sign(keypair, 'aaa'), 'signatures should be deterministic');

    // changing input should change signature
    t.notEqual(sign(keypair, 'aaa'), sign(keypair, 'xxx'), 'different inputs should make different signature');
    t.notEqual(sign(keypair, 'aaa'), sign(keypair2, 'aaa'), 'different keys should make different signature');

    // encoding of input msg
    let snowmanStringSig = sign(keypair, snowmanString);
    let snowmanBytesSig = sign(keypair, snowmanBytes);
    if (isErr(snowmanStringSig)) {
        t.ok(false, 'signature error ' + snowmanStringSig);
        t.end(); return;
    }
    if (isErr(snowmanBytesSig)) {
        t.ok(false, 'signature error ' + snowmanBytesSig);
        t.end(); return;
    }
    t.ok(verify(keypair.address, snowmanStringSig, snowmanString), 'signature roundtrip works on snowman utf-8 string');
    t.ok(verify(keypair.address, snowmanBytesSig, snowmanBytes), 'signature roundtrip works on snowman Uint8Array');

    t.end();
});

t.test('decodeAuthorKeypairToBytes checks Uint8Array length', (t: any) => {
    interface Vector {
        valid: Boolean,
        keypair: AuthorKeypair,
    }
    let vectors: Vector[] = [
        {
            valid: true,
            keypair: {
                address: '@suzy.b724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a',
                secret: 'bwgwycyh4gytyw4p2cp55t53wqhbxb7kqnj4assaazroviffuqn7a'
            },
        }, {
            valid: false,
            keypair: {
                address: '@suzy.b724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a',
                secret: 'b'  // valid base32 but wrong length
            },
        }, {
            valid: false,
            keypair: {
                address: '@suzy.b724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a',
                secret: 'b???'  // invalid base32
            },
        }, {
            valid: false,
            keypair: {
                address: '@suzy.b724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a',
                secret: 'baa'  // valid base32 but wrong length
            },
        }, {
            valid: false,
            keypair: {
                address: '@suzy.b',  // valid base32 but wrong length
                secret: 'bwgwycyh4gytyw4p2cp55t53wqhbxb7kqnj4assaazroviffuqn7a'
            },
        }, {
            valid: false,
            keypair: {
                address: '@suzy.b???',  // invalid base32
                secret: 'bwgwycyh4gytyw4p2cp55t53wqhbxb7kqnj4assaazroviffuqn7a'
            },
        }, {
            valid: false,
            keypair: {
                address: '@suzy.baa',  // valid base32 but wrong length
                secret: 'bwgwycyh4gytyw4p2cp55t53wqhbxb7kqnj4assaazroviffuqn7a'
            },
        }, {
            valid: false,
            keypair: {
                address: '@suzy.724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a', // no b
                secret: 'bwgwycyh4gytyw4p2cp55t53wqhbxb7kqnj4assaazroviffuqn7a'
            },
        }, {
            valid: false,
            keypair: {
                address: '@suzy.b724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a',
                secret: 'wgwycyh4gytyw4p2cp55t53wqhbxb7kqnj4assaazroviffuqn7a'  // no b
            },
        },
    ];

    for (let { valid, keypair } of vectors) {
        let keypairBytesOrErr = decodeAuthorKeypairToBytes(keypair);
        if (valid) {
            t.same(keypairBytesOrErr instanceof ValidationError, false, 'should not be an error: ' + JSON.stringify(keypair));
        } else {
            t.same(keypairBytesOrErr instanceof ValidationError, true, 'should be an error: ' + JSON.stringify(keypair));
        }
    }
    t.end();
});
