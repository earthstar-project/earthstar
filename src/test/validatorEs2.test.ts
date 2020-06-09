import t = require('tap');
import { Crypto } from '../crypto/crypto';
import { Document, RawCryptKey } from '../util/types';
import { ValidatorEs2 } from '../validator/es2';

let log = console.log;

let keypair1 = Crypto.generateKeypair();
let author1: RawCryptKey = keypair1.public;
let now = 1500000000000000;
let Val = ValidatorEs2;

let snowmanJsString = '☃';
let snowmanBufferUtf8 = Buffer.from([0xe2, 0x98, 0x83]);
let snowmanJs2 = snowmanBufferUtf8.toString('utf8');
let snowmanU = '\u2604';

t.test('keyIsValid', (t: any) => {
    t.ok(Val.pathIsValid('hello'), 'regular public key');
    t.ok(Val.pathIsValid('~@aaa.ed25519/foo/bar'), 'valid key with write permission');

    t.ok(Val.pathIsValid(''), 'empty string');
    t.ok(Val.pathIsValid(' '), 'space');

    // forbidden: non-printable characters and utf-8
    t.notOk(Val.pathIsValid('hello\n'), 'contains \\n');
    t.notOk(Val.pathIsValid('aa\tbb'), 'contains \\t');
    t.notOk(Val.pathIsValid('\x00'), 'null byte');
    t.notOk(Val.pathIsValid(snowmanJsString), 'snowman');
    t.notOk(Val.pathIsValid(snowmanJs2), 'snowman 2');
    t.notOk(Val.pathIsValid(snowmanU), 'snowman 3');

    t.done();
});

t.test('authorCanWriteToKey', (t: any) => {
    let author = 'abcdefg';  // no '@'
    t.ok(Val.authorCanWriteToPath(author, 'public'), 'regular public key');
    t.ok(Val.authorCanWriteToPath(author, author + '/about'), 'public key containing author');
    t.ok(Val.authorCanWriteToPath(author, '~' + author + '/about'), 'only writable by author');
    t.ok(Val.authorCanWriteToPath(author, '~notme' + '~' + author + '/about'), 'writable by me and someone else');

    t.ok(Val.authorCanWriteToPath(author, '~' + author + '/about/~'), 'extra tilde');
    t.ok(Val.authorCanWriteToPath(author, '~' + author + '/about/~@notme.ed25519'), 'second author');

    t.notOk(Val.authorCanWriteToPath(author, '~notme.ed25519/about'), 'only writable by someone else');
    t.notOk(Val.authorCanWriteToPath(author, 'zzz/~/zzz'), 'nobody can write to a key with a bare ~');

    t.done();
});

t.test('hashItem', (t: any) => {
    let item1: Document = {
        format: 'es.2',
        workspace: 'gardenclub',
        path: 'k1',
        value: 'v1',
        timestamp: 1,
        author: '@me.ed25519',
        signature: 'xxx.sig.ed25519',
    };
    t.equal(Val.hashDocument(item1), '89b37cdfb52ac4c6d85599cdb19d1ff0d6340b924478ea7db36cce3912839db3');
    t.done();
});

t.test('signItem and itemSignatureIsValid', (t: any) => {
    let item1: Document = {
        format: 'es.2',
        workspace: 'gardenclub',
        path: 'k1',
        value: 'v1',
        timestamp: 1,
        author: author1,
        signature: '',
    };
    t.notOk(Val.documentSignatureIsValid(item1), 'item with empty sig is not valid');

    let signedItem = Val.signDocument(keypair1, item1);
    t.ok(signedItem.signature.length > 10, 'item looks like it has some kind of signature');
    t.ok(Val.documentSignatureIsValid(signedItem), 'signature is actually valid');

    // modify various things and ensure the signature becomes invalid
    t.notOk(
        Val.documentSignatureIsValid({...signedItem, signature: 'xxx.sig.ed25519'}),
        'garbage sig is not valid'
    );
    t.notOk(
        Val.documentSignatureIsValid({...signedItem, format: 'xxx' as any}),
        'sig not valid if schema changes'
    );
    t.notOk(
        Val.documentSignatureIsValid({...signedItem, path: 'xxx'}),
        'sig not valid if key changes'
    );
    t.notOk(
        Val.documentSignatureIsValid({...signedItem, value: 'xxx'}),
        'sig not valid if value changes'
    );
    t.notOk(
        Val.documentSignatureIsValid({...signedItem, timestamp: 9999}),
        'sig not valid if timestamp changes'
    );
    t.notOk(
        Val.documentSignatureIsValid({...signedItem, author: '@notme.ed25519'}),
        'sig not valid if author changes'
    );

    t.done();
});

/*
// this was moved to storeMemory.ts
t.test('historySortFn', (t: any) => {
    let item1: Item = {
        format: 'es.2',
        workspace: 'gardenclub',
        key: 'k1',
        value: 'v1',
        timestamp: 1,
        author: '@1.ed25519',
        signature: 'xxx',
    };
    let item2a: Item = {
        format: 'es.2',
        workspace: 'gardenclub',
        key: 'k2',
        value: 'v2',
        timestamp: 2,
        author: '@2.ed25519',
        signature: 'aaa',
    };
    let item2b: Item = {
        format: 'es.2',
        workspace: 'gardenclub',
        key: 'k2',
        value: 'v2',
        timestamp: 2,
        author: '@2.ed25519',
        signature: 'bbb',
    };
    let input = [item1, item2a, item2b];
    let correct = [item2b, item2a, item1];  // timestamp DESC, signatures DESC
    input.sort(historySortFn);
    t.same(input, correct, 'historySortFn: sort order is correct');
    t.done();
});
*/

t.test('itemIsValid', (t: any) => {
    let item1: Document = {
        format: 'es.2',
        workspace: 'gardenclub',
        path: 'k1',
        value: 'v1',
        timestamp: now,
        author: author1,
        signature: 'xxx',
    };
    let signedItem = Val.signDocument(keypair1, item1);

    t.ok(Val.documentIsValid(signedItem), 'valid item');

    t.notOk(Val.documentIsValid({...signedItem, format: false as any}), 'format wrong datatype');
    t.notOk(Val.documentIsValid({...signedItem, workspace: false as any}), 'workspace wrong datatype');
    t.notOk(Val.documentIsValid({...signedItem, path: false as any}), 'key wrong datatype');
    t.notOk(Val.documentIsValid({...signedItem, value: false as any}), 'value wrong datatype');
    t.notOk(Val.documentIsValid({...signedItem, timestamp: false as any}), 'timestamp wrong datatype');
    t.notOk(Val.documentIsValid({...signedItem, author: false as any}), 'author wrong datatype');
    t.notOk(Val.documentIsValid({...signedItem, signature: false as any}), 'signature wrong datatype');

    t.notOk(Val.documentIsValid({...signedItem, extra: 'xxx'} as any), 'extra property in object');

    t.notOk(Val.documentIsValid({...signedItem, format: snowmanJsString}), 'format non-ascii');
    t.notOk(Val.documentIsValid({...signedItem, workspace: snowmanJsString}), 'workspace non-ascii');
    t.notOk(Val.documentIsValid({...signedItem, path: snowmanJsString}), 'key non-ascii');
    t.notOk(Val.documentIsValid({...signedItem, author: snowmanJsString}), 'author non-ascii');
    t.notOk(Val.documentIsValid({...signedItem, signature: snowmanJsString}), 'signature non-ascii');

    t.notOk(Val.documentIsValid({...signedItem, format: '\n'}), 'newline in format');
    t.notOk(Val.documentIsValid({...signedItem, workspace: '\n'}), 'newline in workspace');
    t.notOk(Val.documentIsValid({...signedItem, path: '\n'}), 'newline in key');
    t.notOk(Val.documentIsValid({...signedItem, author: '\n'}), 'newline in author');
    t.notOk(Val.documentIsValid({...signedItem, signature: '\n'}), 'newline in signature');

    t.notOk(Val.documentIsValid({...signedItem, format: 'xxxxxx' as any}), 'unknown format');

    let missingKey = {...signedItem};
    delete missingKey.path;
    t.notOk(Val.documentIsValid(missingKey), 'missing key');

    t.notOk(Val.documentIsValid({...signedItem, author: 'a\nb'}), 'newline in author');
    t.notOk(Val.documentIsValid({...signedItem, path: '\n'}), 'invalid key');
    t.notOk(Val.documentIsValid({...signedItem, path: '{}'}), 'no write permission');

    t.notOk(Val.documentIsValid(item1), 'bad signature');
    t.notOk(Val.documentIsValid({...signedItem, timestamp: now / 1000}), 'timestamp too small, probably in milliseconds');
    t.notOk(Val.documentIsValid({...signedItem, timestamp: now * 2}), 'timestamp in future');
    t.notOk(Val.documentIsValid({...signedItem, timestamp: Number.MAX_SAFE_INTEGER * 2}), 'timestamp way too large');

    t.done();
});
