import t = require('tap');

import {
    AuthorAddress,
    Document,
} from '../util/types';
import {
    generateAuthorKeypair
} from '../crypto/crypto';
import {
    ValidatorEs2
} from '../validator/es2';

let keypair1 = generateAuthorKeypair('test');
let author1: AuthorAddress = keypair1.address;
let now = 1500000000000000;
let Val = ValidatorEs2;

let snowmanJsString = '☃';
let snowmanBufferUtf8 = Buffer.from([0xe2, 0x98, 0x83]);
let snowmanJs2 = snowmanBufferUtf8.toString('utf8');
let snowmanU = '\u2604';

type IsValidPathVector = {
    note?: string,
    path : string,
    valid : boolean,
};
t.test('keyIsValid', (t: any) => {
    let vectors : IsValidPathVector[] = [
        { valid: false, path: '', note: 'empty string' },
        { valid: false, path: ' ', note: 'just a space' },
        { valid: false, path: '\x00', note: 'null byte' },
        { valid: false, path: 'not-starting-with-slash' },
        { valid: false, path: ' /starts-with-space' },
        { valid: false, path: '/ends-with-space ' },
        { valid: false, path: '/space in the middle' },
        { valid: false, path: '/with"' },
        { valid: false, path: '/with<' },
        { valid: false, path: '/with\nnewline' },
        { valid: false, path: '/' + snowmanJsString, note: 'snowman 1' },
        { valid: false, path: '/' + snowmanJs2, note: 'snowman 2' },
        { valid: false, path: '/' + snowmanU, note: 'snowman 3' },

        { valid: true, path: '/' },
        { valid: true, path: '/foo' },
        { valid: true, path: '/FOO' },
        { valid: true, path: '/foo/' },
        { valid: true, path: '/foo/1234' },
        { valid: true, path: '/about/~@suzy.abc/name' },
        { valid: true, path: '/wiki/shared/Garden%20Gnome' },
    ]
    for (let v of vectors) {
        t.same(v.valid, Val.pathIsValid(v.path),
            v.note || `${v.valid}: ${v.path}`);
    }
    t.end();
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

t.test('hashDocument', (t: any) => {
    let doc1: Document = {
        format: 'es.2',
        workspace: '//gardenclub.xxxxxxxxxxxxxxxxxxxx',
        path: '/k1',
        value: 'v1',
        timestamp: 1,
        author: '@me.ed25519',
        signature: 'xxx.sig.ed25519',
    };
    t.equal(Val.hashDocument(doc1), '38f7d6d6de5b3fcd2abf52e03dc4eab8a32d7ca3e1c2ab30486598aa645a687f');
    t.done();
});

t.test('signDocument and documentSignatureIsValid', (t: any) => {
    let doc1: Document = {
        format: 'es.2',
        workspace: '//gardenclub.xxxxxxxxxxxxxxxxxxxx',
        path: '/k1',
        value: 'v1',
        timestamp: 1,
        author: author1,
        signature: '',
    };
    t.notOk(Val.documentSignatureIsValid(doc1), 'doc with empty sig is not valid');

    let signedDoc = Val.signDocument(keypair1, doc1);
    t.ok(signedDoc.signature.length > 10, 'doc looks like it has some kind of signature');
    t.ok(Val.documentSignatureIsValid(signedDoc), 'signature is actually valid');

    // modify various things and ensure the signature becomes invalid
    t.notOk(
        Val.documentSignatureIsValid({...signedDoc, signature: 'xxx.sig.ed25519'}),
        'garbage sig is not valid'
    );
    t.notOk(
        Val.documentSignatureIsValid({...signedDoc, format: 'xxx' as any}),
        'sig not valid if schema changes'
    );
    t.notOk(
        Val.documentSignatureIsValid({...signedDoc, path: 'xxx'}),
        'sig not valid if key changes'
    );
    t.notOk(
        Val.documentSignatureIsValid({...signedDoc, value: 'xxx'}),
        'sig not valid if value changes'
    );
    t.notOk(
        Val.documentSignatureIsValid({...signedDoc, timestamp: 9999}),
        'sig not valid if timestamp changes'
    );
    t.notOk(
        Val.documentSignatureIsValid({...signedDoc, author: '@notme.ed25519'}),
        'sig not valid if author changes'
    );

    t.done();
});

t.test('documentIsValid', (t: any) => {
    let doc1: Document = {
        format: 'es.2',
        workspace: '//gardenclub.xxxxxxxxxxxxxxxxxxxx',
        path: '/k1',
        value: 'v1',
        timestamp: now,
        author: author1,
        signature: 'xxx',
    };
    let signedDoc = Val.signDocument(keypair1, doc1);

    t.ok(Val.documentIsValid(signedDoc), 'valid doc');

    t.notOk(Val.documentIsValid({...signedDoc, format: false as any}), 'format wrong datatype');
    t.notOk(Val.documentIsValid({...signedDoc, workspace: false as any}), 'workspace wrong datatype');
    t.notOk(Val.documentIsValid({...signedDoc, path: false as any}), 'key wrong datatype');
    t.notOk(Val.documentIsValid({...signedDoc, value: false as any}), 'value wrong datatype');
    t.notOk(Val.documentIsValid({...signedDoc, timestamp: false as any}), 'timestamp wrong datatype');
    t.notOk(Val.documentIsValid({...signedDoc, author: false as any}), 'author wrong datatype');
    t.notOk(Val.documentIsValid({...signedDoc, signature: false as any}), 'signature wrong datatype');

    t.notOk(Val.documentIsValid({...signedDoc, extra: 'xxx'} as any), 'extra property in object');

    t.notOk(Val.documentIsValid({...signedDoc, format: snowmanJsString}), 'format non-ascii');
    t.notOk(Val.documentIsValid({...signedDoc, workspace: snowmanJsString}), 'workspace non-ascii');
    t.notOk(Val.documentIsValid({...signedDoc, path: snowmanJsString}), 'key non-ascii');
    t.notOk(Val.documentIsValid({...signedDoc, author: snowmanJsString}), 'author non-ascii');
    t.notOk(Val.documentIsValid({...signedDoc, signature: snowmanJsString}), 'signature non-ascii');

    t.notOk(Val.documentIsValid({...signedDoc, format: '\n'}), 'newline in format');
    t.notOk(Val.documentIsValid({...signedDoc, workspace: '\n'}), 'newline in workspace');
    t.notOk(Val.documentIsValid({...signedDoc, path: '\n'}), 'newline in key');
    t.notOk(Val.documentIsValid({...signedDoc, author: '\n'}), 'newline in author');
    t.notOk(Val.documentIsValid({...signedDoc, signature: '\n'}), 'newline in signature');

    t.notOk(Val.documentIsValid({...signedDoc, format: 'xxxxxx' as any}), 'unknown format');

    let missingKey = {...signedDoc};
    delete missingKey.path;
    t.notOk(Val.documentIsValid(missingKey), 'missing key');

    t.notOk(Val.documentIsValid({...signedDoc, author: 'a\nb'}), 'newline in author');
    t.notOk(Val.documentIsValid({...signedDoc, path: '\n'}), 'invalid key');
    t.notOk(Val.documentIsValid({...signedDoc, path: '{}'}), 'no write permission');

    t.notOk(Val.documentIsValid(doc1), 'bad signature');
    t.notOk(Val.documentIsValid({...signedDoc, timestamp: now / 1000}), 'timestamp too small, probably in milliseconds');
    t.notOk(Val.documentIsValid({...signedDoc, timestamp: now * 2}), 'timestamp in future');
    t.notOk(Val.documentIsValid({...signedDoc, timestamp: Number.MAX_SAFE_INTEGER * 2}), 'timestamp way too large');

    t.done();
});
