import t = require('tap');
import { Keypair, RawCryptKey } from './types';
import { Crypto } from './crypto';
import {
    encodePubkey,
    decodePubkey,
    encodeSecret,
    decodeSecret,
    encodeSig,
    decodeSig,
    encodePair,
    decodePair
} from './cryptoUtil';

//import {
//    sha256,
//    generateKeypair,
//    addSigilToKey,
//    removeSigilFromKey,
//    sign,
//    isSignatureValid,
//    /*
//    _derToStringPublic,
//    _derToStringSecret,
//    _stringToDerPublic,
//    _stringToDerSecret,
//    _makeKeypairDerBuffers,
//    _derPrefixPublic,
//    _derPrefixSecret,
//    */
//} from './crypto';

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
        t.equal(Crypto.sha256(input), output, `hash of ${JSON.stringify(input)}`);
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
            Crypto.sha256(input),
            output,
            `hash of buffer with bytes: ${JSON.stringify(Array.from(input))}`
        );
    }
    t.end();
});

t.test('generateKeypair', (t: any) => {
    let keypair = Crypto.generateKeypair();
    t.equal(typeof keypair.public, 'string', 'keypair has public');
    t.equal(typeof keypair.secret, 'string', 'keypair has secret');
    t.equal(keypair.public[0], '@', 'keypair.public starts with @');
    t.notEqual(keypair.secret[0], '@', 'keypair.secret does not start with @');
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
    let keypair = Crypto.generateKeypair();
    let keypairB = decodePair(keypair);
    let keypair2 = encodePair(keypairB);
    let keypairB2 = decodePair(keypair);

    t.same(keypair, keypair2, 'keypair encoding/decoding roundtrip 1');
    t.same(keypairB, keypairB2, 'keypair encoding/decoding roundtrip 2');

    t.done();
});

t.test('signatures', (t: any) => {
    let input = 'abc';
    let keypair = Crypto.generateKeypair();
    let keypair2 = Crypto.generateKeypair();
    let sig = Crypto.sign(keypair, input);
    let sig2 = Crypto.sign(keypair2, input);

    t.ok(Crypto.verify(keypair.public, sig, input), 'real signature is valid');

    // ways a signature should fail
    t.notOk(Crypto.verify(keypair.public, 'otherSig', input), 'garbage signature is not valid');
    t.notOk(Crypto.verify(keypair.public, sig2, input), 'signature from another key is not valid');
    t.notOk(Crypto.verify(keypair.public, sig, 'otherInput'), 'signature is not valid with different input');
    t.notOk(Crypto.verify('otherKey', sig, input), 'signature is not valid with garbage key');

    // changing input should change signature
    t.notEqual(Crypto.sign(keypair, 'aaa'), Crypto.sign(keypair, 'xxx'), 'different inputs should make different signature');
    t.notEqual(Crypto.sign(keypair, 'aaa'), Crypto.sign(keypair2, 'aaa'), 'different keys should make different signature');

    // determinism
    t.equal(Crypto.sign(keypair, 'aaa'), Crypto.sign(keypair, 'aaa'), 'signatures should be deterministic');

    // encoding
    let snowmanStringSig = Crypto.sign(keypair, snowmanJsString);
    t.ok(Crypto.verify(keypair.public, snowmanStringSig, snowmanJsString), 'signature roundtrip works on snowman utf-8 string');
    let snowmanBufferSig = Crypto.sign(keypair, snowmanBufferUtf8);
    t.ok(Crypto.verify(keypair.public, snowmanBufferSig, snowmanBufferUtf8), 'signature roundtrip works on snowman buffer');

    t.end();
});
//
