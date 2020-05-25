import t = require('tap');

import { Keypair } from './types';
import {
    sha256,
    generateKeypair,
    addSigilToKey,
    removeSigilFromKey,
    sign,
    isSignatureValid,
    _derToStringPublic,
    _derToStringSecret,
    _stringToDerPublic,
    _stringToDerSecret,
    _makeKeypairDerBuffers,
    _derPrefixPublic,
    _derPrefixSecret,
} from './crypto';

let log = console.log;

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
        t.equal(
            sha256(input),
            output,
            `hash of buffer with bytes: ${JSON.stringify(Array.from(input))}`
        );
    }
    t.end();
});

t.test('generateKeypair', (t: any) => {
    let keypair = generateKeypair();
    t.equal(typeof keypair.public, 'string', 'keypair has public');
    t.equal(typeof keypair.secret, 'string', 'keypair has secret');
    t.notEqual(keypair.public[0], '@', 'keypair does not have sigils');
    t.end();
});

t.test('key conversion from buffer to string and back', (t: any) => {
    let bufPair = _makeKeypairDerBuffers();

    let pubBuf = bufPair.public;
    let pubStr = _derToStringPublic(pubBuf);
    let pubBuf2 = _stringToDerPublic(pubStr);
    let pubStr2 = _derToStringPublic(pubBuf2);
    t.same(pubBuf, pubBuf2, 'public key: buffer roundtrip to string and back');
    t.same(pubStr, pubStr2, 'public key: string roundtrip to buffer and back');
    t.equal(pubStr.length, 44, 'public key: string length 44');

    let secBuf = bufPair.secret;
    let secStr = _derToStringPublic(secBuf);
    let secBuf2 = _stringToDerSecret(secStr);
    let secStr2 = _derToStringPublic(secBuf2);
    t.same(secBuf, secBuf2, 'secret key: buffer roundtrip to string and back');
    t.same(secStr, secStr2, 'secret key: string roundtrip to buffer and back');
    t.equal(secStr.length, 44, 'secret key: string length 44');
    /*
    log('bufPair    ', bufPair);
    log('.'),
    log('sec prefix ', _secretPrefix);
    log('sec prefix ', _secretPrefix.toString('base64'));
    log('.'),
    log('secBuf     ', secBuf);
    log('secBuf.b64 ', secBuf.toString('base64'));
    log('.'),
    log('secStr     ', Buffer.from(secStr, 'base64'));
    log('secStr.b64 ', secStr);
    log('.'),
    log('secBuf2    ', secBuf2);
    log('secBuf2.b64', secBuf2.toString('base64'));
    log('.'),
    log('secStr2    ', Buffer.from(secStr2, 'base64'));
    log('secStr2.b64', secStr2);
    */

    t.done();
});

let exampleKeypair: Keypair = {
    public: 'IoFHLOqJc8/2F9PUgxY7M4n5733r3wT/w3ZAXGYoyH4=',
    secret: '+W1lx7/jbsO8KiXz4LrKYjswbO8vjFYczG0KokpFoME=',
};

t.test('key sigils', (t: any) => {
    let raw = exampleKeypair.public;
    let sigilified = addSigilToKey(raw);
    let raw2 = removeSigilFromKey(sigilified);
    let sigilified2 = addSigilToKey(raw2);
    t.notEqual(raw[0], '@', 'raw does not start with "@"');
    t.equal(sigilified[0], '@', 'sigilified starts with "@"');
    t.equal(raw, raw2, 'roundtrip from raw');
    t.equal(sigilified, sigilified2, 'roundtrip from sigilified');

    t.throws(() => removeSigilFromKey('xxx'));
    t.throws(() => removeSigilFromKey('@xxx'));
    t.throws(() => removeSigilFromKey('xxx.ed25519'));

    t.end();
});

t.test('signatures', (t: any) => {
    let input = 'abc';
    let keypair = exampleKeypair;
    let keypair2 = generateKeypair();
    let sig = sign(input, keypair.secret);

    t.ok(sig.endsWith('.sig.ed25519'), 'signature ends with .sig.ed25519');
    t.equal(sig.length, 100, 'signature string length 100 including .sig.ed25519');

    t.ok(isSignatureValid(input, sig, keypair.public), 'real signature is valid');

    // ways a signature should fail
    t.notOk(
        isSignatureValid(input, 'xxx', keypair.public),
        'signature missing .ed.25519 is not valid'
    );
    t.notOk(isSignatureValid(input, 'xxx.sig.ed25519', keypair.public), 'altered signature is not valid');
    t.notOk(isSignatureValid('otherInput', sig, keypair.public), 'signature is not valid with different input');
    t.notOk(isSignatureValid(input, sig, 'wrongKey'), 'signature is not valid with garbage key');
    t.notOk(isSignatureValid(input, sig, keypair2.secret), 'signature is not valid with different key');

    // changing input should change signature
    t.notEqual(sign('aaa', keypair.secret), sign('x', keypair.secret), 'different inputs should make different signature');
    t.notEqual(sign('aaa', keypair.secret), sign('aaa', keypair2.secret), 'different keys should make different signature');

    // determinism
    t.equal(sign('aaa', keypair.secret), sign('aaa', keypair.secret), 'signatures should be deterministic');

    // encoding
    let snowmanStringSig = sign(snowmanJsString, keypair.secret);
    t.ok(isSignatureValid(snowmanJsString, snowmanStringSig, keypair.public), 'signature roundtrip works on snowman utf-8 string');
    let snowmanBufferSig = sign(snowmanBufferUtf8, keypair.secret);
    t.ok(isSignatureValid(snowmanBufferUtf8, snowmanBufferSig, keypair.public), 'signature roundtrip works on snowman buffer');

    t.end();
});
