import t = require('tap');
//t.runOnly = true;

import {
    AuthorKeypair,
    isErr,
} from '../util/types';
import {
    LowLevelCrypto,
    generateAuthorKeypair,
    sha256base32,
    sign,
    verify,
    checkAuthorKeypairIsValid,
} from '../crypto/crypto';
import {
    decodeAuthorKeypair,
    decodeBase32ToBuffer,
    decodePubkey,
    decodeSecret,
    decodeSig,
    encodeAuthorKeypair,
    encodeBufferToBase32,
    encodePubkey,
    encodeSecret,
    encodeSig,
} from '../crypto/encoding';

// use this unicode character for testing
let snowmanJsString = '☃';
let snowmanBufferUtf8 = Buffer.from([0xe2, 0x98, 0x83]);

t.test('snowman test data', (t: any) => {
    t.same(Buffer.from(snowmanJsString, 'utf8'), snowmanBufferUtf8, 'snowman test data is good');
    t.end();
});

t.test('base32 encoding', (t: any) => {
    let buf = Buffer.from([1, 2, 3, 4, 5]);
    let b32 = encodeBufferToBase32(buf);
    let buf2 = decodeBase32ToBuffer(b32);
    let b32_2 = encodeBufferToBase32(buf2);

    t.same(buf, buf2, 'buffer roundtrip to base32');
    t.same(b32, b32_2, 'base32 roundtrip to buffer');
    t.ok(b32.startsWith('b'), 'base32 startswith b');

    t.same(decodeBase32ToBuffer('b'), Buffer.from([]), 'base32 can decode just the string "b" to an empty buffer');

    t.throws(() => decodeBase32ToBuffer(''), 'decoding base32 throws an exception if string is empty');
    t.throws(() => decodeBase32ToBuffer('abc'), 'decoding base32 throws an exception when it does not start with "b"');
    t.throws(() => decodeBase32ToBuffer('b123'), 'decoding base32 throws when encountering invalid base32 character');
    t.throws(() => decodeBase32ToBuffer('babc?xyz'), 'decoding base32 throws when encountering invalid base32 character');
    t.throws(() => decodeBase32ToBuffer('babc xyz'), 'decoding base32 throws when encountering invalid base32 character');
    t.throws(() => decodeBase32ToBuffer('b abcxyz'), 'decoding base32 throws when encountering invalid base32 character');
    t.throws(() => decodeBase32ToBuffer('babcxyz '), 'decoding base32 throws when encountering invalid base32 character');
    t.throws(() => decodeBase32ToBuffer('babcxyz\n'), 'decoding base32 throws when encountering invalid base32 character');
    t.throws(() => decodeBase32ToBuffer('BABC'), 'decoding base32 throws when encountering a different multibase encoding');

    t.end();
});

t.test('sha256 of strings', (t: any) => {
    // prettier-ignore
    let vectors : [string, string][] = [
        // input, output
        ['', 'b4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq'],
        ['abc', 'bxj4bnp4pahh6uqkbidpf3lrceoyagyndsylxvhfucd7wd4qacwwq'],
        [snowmanJsString, 'bkfsdgyoht3fo6jni32ac3yspk4f2exm4fxy5elmu7lpbdnhum3ga'],
    ];
    for (let [input, output] of vectors) {
        t.equal(sha256base32(input), output, `hash of ${JSON.stringify(input)}`);
    }
    t.end();
});

t.test('sha256 of buffers', (t: any) => {
    // prettier-ignore
    let vectors : [Buffer, string][] = [
        // input, output
        [Buffer.from('', 'utf8'), 'b4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq'],
        [Buffer.from([]), 'b4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq'],
        [Buffer.from('abc', 'utf8'), 'bxj4bnp4pahh6uqkbidpf3lrceoyagyndsylxvhfucd7wd4qacwwq'],
        [Buffer.from([97, 98, 99]), 'bxj4bnp4pahh6uqkbidpf3lrceoyagyndsylxvhfucd7wd4qacwwq'],
        // snowman in utf-8
        [snowmanBufferUtf8, 'bkfsdgyoht3fo6jni32ac3yspk4f2exm4fxy5elmu7lpbdnhum3ga'],
    ];
    for (let [input, output] of vectors) {
        t.equal(sha256base32(input), output, `hash of buffer with bytes: ${JSON.stringify(Array.from(input))}`)
    }
    t.end();
});

t.test('generateAuthorKeypair', (t: any) => {
    t.ok(isErr(generateAuthorKeypair('abc')), 'error when author shortname is too short');
    t.ok(isErr(generateAuthorKeypair('abcde')), 'error when author shortname is too long');
    t.ok(isErr(generateAuthorKeypair('TEST')), 'error when author shortname is uppercase');
    t.ok(isErr(generateAuthorKeypair('1234')), 'error when author shortname has numbers');
    t.ok(isErr(generateAuthorKeypair('----')), 'error when author shortname has dashes');
    t.ok(isErr(generateAuthorKeypair('')), 'error when author shortname is empty');

    let keypair = generateAuthorKeypair('ok99');
    if (isErr(keypair)) {
        t.ok(false, 'should have succeeded but instead was an error: ' + keypair);
    } else {
        t.equal(typeof keypair.address, 'string', 'keypair has address');
        t.equal(typeof keypair.secret, 'string', 'keypair has secret');
        t.equal(keypair.address[0], '@', 'keypair.address starts with @');
        t.ok(keypair.address.startsWith('@ok99.'), 'keypair.address starts with @ok99.');
        t.notEqual(keypair.secret[0], '@', 'keypair.secret does not start with @');
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
        t.ok(false, 'keypair1 was not generated successfully');
        t.end();
        return;
    }

    t.equal(checkAuthorKeypairIsValid(keypair1), true, 'keypair1 is valid');
    t.ok(isErr(checkAuthorKeypairIsValid({
        address: '',
        secret: keypair1.secret,
    })), 'empty address makes keypair invalid');
    t.ok(isErr(checkAuthorKeypairIsValid({
        address: keypair1.address + '0',
        secret: keypair1.secret,
    })), 'adding char to pubkey makes keypair invalid');
    t.ok(isErr(checkAuthorKeypairIsValid({
        address: keypair1.address.slice(0, -8) + '00000000',
        secret: keypair1.secret,
    })), 'altering pubkey makes keypair invalid');
    t.ok(isErr(checkAuthorKeypairIsValid({
        address: keypair1.address,
        secret: keypair1.secret.slice(0, -8) + '00000000',
    })), 'altering secret makes keypair invalid');
    t.ok(isErr(checkAuthorKeypairIsValid({
        address: keypair1.address,
        secret: keypair2.secret,
    })), 'mixing address and secret from 2 different keypairs is invalid');
    t.ok(isErr(checkAuthorKeypairIsValid({
        address: keypair1.address,
        secret: '',
    })), 'empty secret makes keypair invalid');
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

t.test('encode / decode signature, secret, pubkey', (t: any) => {
    let buf = new Buffer([0, 10, 20, 122, 123, 124]);
    let str = encodeSig(buf);
    let buf2 = decodeSig(str);
    let str2 = encodeSig(buf2);
    t.same(buf, buf2, 'encodeSig roundtrip: buffer');
    t.same(str, str2, 'encodeSig roundtrip: string');

    str = encodeSecret(buf);
    buf2 = decodeSecret(str);
    str2 = encodeSecret(buf2);
    t.same(buf, buf2, 'encodeSecret roundtrip: buffer');
    t.same(str, str2, 'encodeSecret roundtrip: string');

    str = encodePubkey(buf);
    buf2 = decodePubkey(str);
    str2 = encodePubkey(buf2);
    t.same(buf, buf2, 'encodePubkey roundtrip: buffer');
    t.same(str, str2, 'encodePubkey roundtrip: string');

    t.done();
});

t.test('key conversion from buffer to string and back', (t: any) => {
    let keypair = generateAuthorKeypair('test');
    if (isErr(keypair)) {
        t.ok(false, 'keypair 1 is an error');
        t.done();
        return;
    }
    let buffers = decodeAuthorKeypair(keypair);
    if (isErr(buffers)) {
        t.ok(false, 'buffers is an error');
        t.done();
        return;
    };
    let keypair2 = encodeAuthorKeypair('test', buffers);
    if (isErr(keypair2)) {
        t.ok(false, 'keypair 2 is an error');
        t.done();
        return;
    }
    let buffers2 = decodeAuthorKeypair(keypair);
    if (isErr(buffers2)) {
        t.ok(false, 'buffers2 is an error');
        t.done();
        return;
    };

    t.same(keypair, keypair2, 'keypair encoding/decoding roundtrip matched (author keypair)');
    t.same(buffers, buffers2, 'keypair encoding/decoding roundtrip matched (buffers)');

    keypair.secret = 'x';
    let err = decodeAuthorKeypair(keypair);
    t.ok(isErr(err), 'decodeAuthorKeypair returns an error if the secret is bad base32');

    t.done();
});

t.test('signatures', (t: any) => {
    let input = 'abc';
    let keypair = generateAuthorKeypair('test') as AuthorKeypair;
    let keypair2 = generateAuthorKeypair('fooo') as AuthorKeypair;
    if (isErr(keypair) || isErr(keypair2)) {
        t.ok(false, 'keypair generation error');
        t.done(); return;
    }
    let sig = sign(keypair, input);
    let sig2 = sign(keypair2, input);
    if (isErr(sig)) {
        t.ok(false, 'signature error ' + sig);
        t.done(); return;
    }
    if (isErr(sig2)) {
        t.ok(false, 'signature error ' + sig2);
        t.done(); return;
    }

    t.ok(verify(keypair.address, sig, input), 'real signature is valid');

    // ways a signature should fail
    t.notOk(verify(keypair.address, 'otherSig', input), 'garbage signature is not valid');
    t.notOk(verify(keypair.address, sig2, input), 'signature from another key is not valid');
    t.notOk(verify(keypair.address, sig, 'otherInput'), 'signature is not valid with different input');
    t.notOk(verify('@bad.address', sig, input), 'invalid author address = invalid signature, return false');

    // changing input should change signature
    t.notEqual(sign(keypair, 'aaa'), sign(keypair, 'xxx'), 'different inputs should make different signature');
    t.notEqual(sign(keypair, 'aaa'), sign(keypair2, 'aaa'), 'different keys should make different signature');

    // determinism
    t.equal(sign(keypair, 'aaa'), sign(keypair, 'aaa'), 'signatures should be deterministic');

    // encoding of input msg
    let snowmanStringSig = sign(keypair, snowmanJsString);
    let snowmanBufferSig = sign(keypair, snowmanBufferUtf8);
    if (isErr(snowmanStringSig)) {
        t.ok(false, 'signature error ' + snowmanStringSig);
        t.done(); return;
    }
    if (isErr(snowmanBufferSig)) {
        t.ok(false, 'signature error ' + snowmanBufferSig);
        t.done(); return;
    }
    t.ok(verify(keypair.address, snowmanStringSig, snowmanJsString), 'signature roundtrip works on snowman utf-8 string');
    t.ok(verify(keypair.address, snowmanBufferSig, snowmanBufferUtf8), 'signature roundtrip works on snowman buffer');

    t.end();
});
