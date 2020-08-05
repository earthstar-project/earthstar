import t = require('tap');
import {
    AuthorKeypair,
    isErr,
} from '../util/types';
import {
    LowLevelCrypto,
    generateAuthorKeypair,
    sha256,
    sign,
    verify,
} from '../crypto/crypto';
import {
    decodeAuthorKeypair,
    decodePubkey,
    decodeSecret,
    decodeSig,
    encodeAuthorKeypair,
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

t.test('sha256 of strings', (t: any) => {
    // prettier-ignore
    let vectors : [string, string][] = [
        // input, output
        ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
        ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
        [snowmanJsString, '51643361c79ecaef25a8de802de24f570ba25d9c2df1d22d94fade11b4f466cc'],
    ];
    for (let [input, output] of vectors) {
        t.equal(LowLevelCrypto.sha256(input), output, `LowLevelCrypto hash of ${JSON.stringify(input)}`);
        t.equal(sha256(input), output, `hash of ${JSON.stringify(input)}`);
    }
    t.end();
});

t.test('sha256 of buffers', (t: any) => {
    // prettier-ignore
    let vectors : [Buffer, string][] = [
        // input, output
        [Buffer.from('', 'utf8'), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
        [Buffer.from([]), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
        [Buffer.from('abc', 'utf8'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
        [Buffer.from([97, 98, 99]), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
        // snowman in utf-8
        [snowmanBufferUtf8, '51643361c79ecaef25a8de802de24f570ba25d9c2df1d22d94fade11b4f466cc'],
    ];
    for (let [input, output] of vectors) {
        t.equal(LowLevelCrypto.sha256(input), output, `LowLevelCrypto hash of buffer with bytes: ${JSON.stringify(Array.from(input))}`)
        t.equal(sha256(input), output, `hash of buffer with bytes: ${JSON.stringify(Array.from(input))}`)
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

    let keypair = generateAuthorKeypair('test');
    if (isErr(keypair)) {
        t.ok(false, 'should have succeeded but instead was an error: ' + keypair);
    } else {
        t.equal(typeof keypair.address, 'string', 'keypair has address');
        t.equal(typeof keypair.secret, 'string', 'keypair has secret');
        t.equal(keypair.address[0], '@', 'keypair.address starts with @');
        t.ok(keypair.address.startsWith('@test.'), 'keypair.address starts with @test.');
        t.notEqual(keypair.secret[0], '@', 'keypair.secret does not start with @');
    }

    t.end();
});

t.test('encode / decode', (t: any) => {
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
