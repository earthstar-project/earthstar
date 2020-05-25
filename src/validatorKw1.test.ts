import t = require('tap');
import { addSigilToKey, generateKeypair } from './crypto';
import { Item, AuthorKey } from './types';
import { ValidatorKw1 } from './validatorKw1';

let log = console.log;

let keypair1 = generateKeypair();
let author1: AuthorKey = addSigilToKey(keypair1.public);
let now = 1500000000000000;
let Val = ValidatorKw1;

t.test('keyIsValid', (t: any) => {
    t.ok(Val.keyIsValid('hello'), 'regular public key');
    t.ok(Val.keyIsValid('hello/there'), 'regular public key');
    t.ok(Val.keyIsValid('(@aaa.ed25519)/foo/bar'), 'valid key with write permission');

    t.notOk(Val.keyIsValid(''), 'empty key');
    t.notOk(Val.keyIsValid('hello\n'), 'contains \\n');

    t.done();
});

t.test('authorCanWriteToKey', (t: any) => {
    let author = '@aaa.ed25519';
    t.ok(Val.authorCanWriteToKey(author, 'public'), 'regular public key');
    t.ok(Val.authorCanWriteToKey(author, author + '/about'), 'public key containing author');
    t.ok(Val.authorCanWriteToKey(author, '(' + author + ')/about'), 'only writable by author');
    t.ok(Val.authorCanWriteToKey(author, '(@notme.ed25519)(' + author + ')/about'), 'writable by me and someone else');

    t.notOk(Val.authorCanWriteToKey(author, '(@notme.ed25519)/about'), 'only writable by someone else');
    t.notOk(Val.authorCanWriteToKey(author, 'zzz()zzz'), 'nobody can write to this key: ()');
    t.notOk(Val.authorCanWriteToKey(author, 'zzz)zzz'), 'nobody can write to this key: )');
    t.notOk(Val.authorCanWriteToKey(author, 'zzz(zzz'), 'nobody can write to this key: (');

    t.done();
});

t.test('hashItem', (t: any) => {
    let item1: Item = {
        format: 'kw.1',
        workspace: 'gardenclub',
        key: 'k1',
        value: 'v1',
        timestamp: 1,
        author: '@me.ed25519',
        signature: 'xxx.sig.ed25519',
    };
    t.equal(Val.hashItem(item1), '54bd2c273bbeecabf773e155456bb166ffb68e897db3aabd5eca239b1efc4cfb');
    t.done();
});

t.test('signItem and itemSignatureIsValid', (t: any) => {
    let item1: Item = {
        format: 'kw.1',
        workspace: 'gardenclub',
        key: 'k1',
        value: 'v1',
        timestamp: 1,
        author: author1,
        signature: '',
    };
    let signedItem = Val.signItem(item1, keypair1.secret);

    t.ok(signedItem.signature.endsWith('.sig.ed25519'), 'item looks like it has a signature');
    t.ok(Val.itemSignatureIsValid(signedItem), 'signature is valid');

    t.notOk(Val.itemSignatureIsValid(item1), 'empty sig is not valid');

    // TODO: once sigs are working, enable these tests
    t.notOk(
        Val.itemSignatureIsValid({...signedItem, signature: 'xxx.sig.ed25519'}),
        'garbage sig is not valid'
    );
    t.notOk(
        Val.itemSignatureIsValid({...signedItem, format: 'xxx' as any}),
        'sig not valid if schema changes'
    );
    t.notOk(
        Val.itemSignatureIsValid({...signedItem, key: 'xxx'}),
        'sig not valid if key changes'
    );
    t.notOk(
        Val.itemSignatureIsValid({...signedItem, value: 'xxx'}),
        'sig not valid if value changes'
    );
    t.notOk(
        Val.itemSignatureIsValid({...signedItem, timestamp: 9999}),
        'sig not valid if timestamp changes'
    );
    t.notOk(
        Val.itemSignatureIsValid({...signedItem, author: '@notme.ed25519'}),
        'sig not valid if author changes'
    );

    t.done();
});

/*
// this was moved to storeMemory.ts
t.test('historySortFn', (t: any) => {
    let item1: Item = {
        format: 'kw.1',
        workspace: 'gardenclub',
        key: 'k1',
        value: 'v1',
        timestamp: 1,
        author: '@1.ed25519',
        signature: 'xxx',
    };
    let item2a: Item = {
        format: 'kw.1',
        workspace: 'gardenclub',
        key: 'k2',
        value: 'v2',
        timestamp: 2,
        author: '@2.ed25519',
        signature: 'aaa',
    };
    let item2b: Item = {
        format: 'kw.1',
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
    let item1: Item = {
        format: 'kw.1',
        workspace: 'gardenclub',
        key: 'k1',
        value: 'v1',
        timestamp: now,
        author: author1,
        signature: 'xxx',
    };
    let signedItem = Val.signItem(item1, keypair1.secret);

    t.ok(Val.itemIsValid(signedItem), 'valid item');

    t.notOk(Val.itemIsValid({...signedItem, format: false as any}), 'schema wrong datatype');
    t.notOk(Val.itemIsValid({...signedItem, key: false as any}), 'key wrong datatype');
    t.notOk(Val.itemIsValid({...signedItem, value: false as any}), 'value wrong datatype');
    t.notOk(Val.itemIsValid({...signedItem, timestamp: false as any}), 'timestamp wrong datatype');
    t.notOk(Val.itemIsValid({...signedItem, author: false as any}), 'author wrong datatype');
    t.notOk(Val.itemIsValid({...signedItem, signature: false as any}), 'signature wrong datatype');

    t.notOk(Val.itemIsValid({...signedItem, format: 'kw.1\n' as any}), 'newline in schema');
    t.notOk(Val.itemIsValid({...signedItem, format: 'xxxxxx' as any}), 'invalid schema');

    let missingKey = {...signedItem};
    delete missingKey.key;
    t.notOk(Val.itemIsValid(missingKey), 'missing key');

    t.notOk(Val.itemIsValid({...signedItem, author: 'a\nb'}), 'newline in author');
    t.notOk(Val.itemIsValid({...signedItem, key: '\n'}), 'invalid key');
    t.notOk(Val.itemIsValid({...signedItem, key: '{}'}), 'no write permission');

    t.notOk(Val.itemIsValid(item1), 'bad signature');
    t.notOk(Val.itemIsValid({...signedItem, timestamp: now / 1000}), 'timestamp too small, probably in milliseconds');
    t.notOk(Val.itemIsValid({...signedItem, timestamp: now * 2}), 'timestamp in future');
    t.notOk(Val.itemIsValid({...signedItem, timestamp: Number.MAX_SAFE_INTEGER * 2}), 'timestamp way too large');

    t.done();
});
