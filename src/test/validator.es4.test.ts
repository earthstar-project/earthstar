import t = require('tap');
//t.runOnly = true;

import {
    AuthorAddress,
    Document,
} from '../util/types';
import {
    generateAuthorKeypair,
    sha256,
} from '../crypto/crypto';
import {
    ValidatorEs4
} from '../validator/es4';

let keypair1 = generateAuthorKeypair('test');
let author1: AuthorAddress = keypair1.address;
let now = 1500000000000000;
let Val = ValidatorEs4;

let snowmanJsString = '☃';
let snowmanBufferUtf8 = Buffer.from([0xe2, 0x98, 0x83]);
let snowmanJs2 = snowmanBufferUtf8.toString('utf8');
let snowmanU = '\u2604';

// microseconds
let SEC = 1000000;
let MIN = SEC * 60;
let HOUR = MIN * 60;
let DAY = HOUR * 24;

type IsValidPathVector = {
    note?: string,
    path : string,
    valid : boolean,
};
t.test('pathIsValid', (t: any) => {
    let vectors : IsValidPathVector[] = [
        { valid: false, path: '', note: 'empty string' },
        { valid: false, path: ' ', note: 'just a space' },
        { valid: false, path: '\x00', note: 'null byte' },
        { valid: false, path: '/', note: 'just one slash' },
        { valid: false, path: 'not/starting/with/slash' },
        { valid: false, path: '/ends/with/slash/' },
        { valid: false, path: ' /starts-with-space' },
        { valid: false, path: '/ends-with-space ' },
        { valid: false, path: '/space in the middle' },
        { valid: false, path: '/double//slash/in/middle' },
        { valid: false, path: '//double/slash/at/start' },
        { valid: false, path: '/double/slash/at/end//' },
        { valid: false, path: '/backslash\\' },
        { valid: false, path: '/double-quote"' },
        { valid: false, path: '/bracket<' },
        { valid: false, path: '/new\nline' },
        { valid: false, path: '/@starts/with/at/sign' },
        { valid: false, path: '/' + snowmanJsString, note: 'snowman 1' },
        { valid: false, path: '/' + snowmanJs2, note: 'snowman 2' },
        { valid: false, path: '/' + snowmanU, note: 'snowman 3' },

        { valid: true, path: '/foo' },
        { valid: true, path: '/FOO', note: 'uppercase' },
        { valid: true, path: '/1234/5678', note: 'digits' },
        { valid: true, path: '/a/b/c/d/e/f/g/h' },
        { valid: true, path: '/about/~@suzy.abc/name' },
        { valid: true, path: '/wiki/shared/Garden%20Gnome' },
        { valid: true, path: '/\'()-._~!*$&+,:=?@%', note: 'all allowed punctuation characters' },
    ]
    for (let v of vectors) {
        t.same(v.valid, Val.pathIsValid(v.path),
            v.note || `${v.valid}: ${v.path}`);
    }
    t.end();
});

t.test('authorCanWriteToPath', (t: any) => {
    let author = '@abcd.xxxx';  // this is too short to be a valid author, but this should be an ok test for this function

    t.ok(Val.authorCanWriteToPath(author, '/public'), 'regular public path');
    t.ok(Val.authorCanWriteToPath(author, '/about/' + author + '/name'), 'public path containing author but no tilde');
    t.ok(Val.authorCanWriteToPath(author, '/about/~' + author + '/name'), 'only writable by author');
    t.ok(Val.authorCanWriteToPath(author, '/chat/~@ffff.xxxx' + '~' + author + '/details'), 'writable by me and someone else');
    t.ok(Val.authorCanWriteToPath(author, '/about/~' + author + '/~'), 'extra tilde does not interfere');

    t.notOk(Val.authorCanWriteToPath(author, '/about/~@ffff.xxxx'), 'only writable by someone else');
    t.notOk(Val.authorCanWriteToPath(author, '/zzz/~/zzz'), 'nobody can write to a path with just a bare ~');

    t.done();
});

t.test('hashDocument', (t: any) => {
    let doc1: Document = {
        format: 'es.4',
        workspace: '+gardenclub.xxxxxxxxxxxxxxxxxxxx',
        path: '/path1',
        contentHash: sha256('content1'),
        content: 'content1',
        timestamp: 1,
        author: '@suzy.xxxxxxxxxxx',
        signature: 'xxxxxxxxxxxxx',
    };
    t.equal(Val.hashDocument(doc1), '971e8a1cc02c6a6e7be9e81765d0658a2db338f951b6c78ea8c5c3284fa233cf', 'expected document hash');

    // now with deleteAfter
    let doc2: Document = {
        format: 'es.4',
        workspace: '+gardenclub.xxxxxxxxxxxxxxxxxxxx',
        path: '/path1',
        contentHash: sha256('content1'),
        content: 'content1',
        timestamp: 1,
        deleteAfter: 2,
        author: '@suzy.xxxxxxxxxxx',
        signature: 'xxxxxxxxxxxxx',
    };
    t.equal(Val.hashDocument(doc2), '292adcd11cceed8ad3de1b49bfb02bf9440b46b2bd5459ebffcde357710c6e68', 'expected document hash with deleteAfter');
    t.done();
});

t.test('signDocument and documentSignatureIsValid', (t: any) => {
    let doc1: Document = {
        format: 'es.4',
        workspace: '+gardenclub.xxxxxxxxxxxxxxxxxxxx',
        path: '/k1',
        contentHash: sha256('content1'),
        content: 'content1',
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
        'sig not valid if path changes'
    );
    t.notOk(
        Val.documentSignatureIsValid({...signedDoc, content: 'xxx'}),
        'sig not valid if content changes'
    );
    t.notOk(
        Val.documentSignatureIsValid({...signedDoc, contentHash: 'xxx'}),
        'sig not valid if contentHash changes'
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
        format: 'es.4',
        workspace: '+gardenclub.xxxxxxxxxxxxxxxxxxxx',
        path: '/k1',
        contentHash: sha256('v1'),
        content: 'v1',
        timestamp: now,
        author: author1,
        signature: 'xxx',
    };

    t.notOk(Val.documentIsValid(doc1), 'bad signature');

    let signedDoc = Val.signDocument(keypair1, doc1);
    t.ok(Val.documentIsValid(signedDoc), 'valid doc');

    t.notOk(Val.documentIsValid({...signedDoc, format: 'a'}), 'change format after signature');
    t.notOk(Val.documentIsValid({...signedDoc, workspace: '+gardenclub.xx'}), 'change workspace after signature');
    t.notOk(Val.documentIsValid({...signedDoc, path: '/a/b/c'}), 'change path after signature');
    t.notOk(Val.documentIsValid({...signedDoc, content: 'abc'}), 'change content after signature');
    t.notOk(Val.documentIsValid({...signedDoc, contentHash: 'abc'}), 'change contentHash after signature');
    t.notOk(Val.documentIsValid({...signedDoc, timestamp: now-1}), 'change timestamp after signature');
    t.notOk(Val.documentIsValid({...signedDoc, author: author1+'x'}), 'change author after signature');
    t.notOk(Val.documentIsValid({...signedDoc, signature: 'x'}), 'change signature after signature');

    t.notOk(Val.documentIsValid({...signedDoc, format: false as any}), 'format wrong datatype');
    t.notOk(Val.documentIsValid({...signedDoc, workspace: false as any}), 'workspace wrong datatype');
    t.notOk(Val.documentIsValid({...signedDoc, path: false as any}), 'path wrong datatype');
    t.notOk(Val.documentIsValid({...signedDoc, content: false as any}), 'content wrong datatype');
    t.notOk(Val.documentIsValid({...signedDoc, contentHash: false as any}), 'contentHash wrong datatype');
    t.notOk(Val.documentIsValid({...signedDoc, timestamp: false as any}), 'timestamp wrong datatype');
    t.notOk(Val.documentIsValid({...signedDoc, author: false as any}), 'author wrong datatype');
    t.notOk(Val.documentIsValid({...signedDoc, signature: false as any}), 'signature wrong datatype');

    t.notOk(Val.documentIsValid({...signedDoc, extra: 'xxx'} as any), 'add extra property after signing');
    t.notOk(Val.documentIsValid(Val.signDocument(keypair1, {...doc1, extra: 'xxx'} as any)), 'add extra property before signing');

    t.notOk(Val.documentIsValid(Val.signDocument(keypair1, {...doc1, format: snowmanJsString})), 'format non-ascii before signing');
    t.notOk(Val.documentIsValid(Val.signDocument(keypair1, {...doc1, workspace: snowmanJsString})), 'workspace non-ascii before signing');
    t.notOk(Val.documentIsValid(Val.signDocument(keypair1, {...doc1, path: snowmanJsString})), 'path non-ascii before signing');
    t.notOk(Val.documentIsValid(Val.signDocument(keypair1, {...doc1, author: snowmanJsString})), 'author non-ascii before signing');
    t.notOk(Val.documentIsValid(Val.signDocument(keypair1, {...doc1, contentHash: snowmanJsString})), 'contentHash non-ascii before signing');

    t.notOk(Val.documentIsValid({...signedDoc, format: snowmanJsString}), 'format non-ascii after signing');
    t.notOk(Val.documentIsValid({...signedDoc, workspace: snowmanJsString}), 'workspace non-ascii after signing');
    t.notOk(Val.documentIsValid({...signedDoc, path: snowmanJsString}), 'path non-ascii after signing');
    t.notOk(Val.documentIsValid({...signedDoc, author: snowmanJsString}), 'author non-ascii after signing');
    t.notOk(Val.documentIsValid({...signedDoc, contentHash: snowmanJsString}), 'contentHash non-ascii after signing');
    t.notOk(Val.documentIsValid({...signedDoc, signature: snowmanJsString}), 'signature non-ascii after signing');

    t.notOk(Val.documentIsValid(Val.signDocument(keypair1, {...doc1, format: '\n'})), 'newline in format before signing');
    t.notOk(Val.documentIsValid(Val.signDocument(keypair1, {...doc1, workspace: '\n'})), 'newline in workspace before signing');
    t.notOk(Val.documentIsValid(Val.signDocument(keypair1, {...doc1, path: '\n'})), 'newline in path before signing');
    t.notOk(Val.documentIsValid(Val.signDocument(keypair1, {...doc1, author: '\n'})), 'newline in author before signing');
    t.notOk(Val.documentIsValid(Val.signDocument(keypair1, {...doc1, contentHash: '\n'})), 'newline in contentHash before signing');

    t.notOk(Val.documentIsValid(Val.signDocument(keypair1, {...doc1, format: 'xxx'})), 'unknown format before signing');

    let docWithMissingPath = {...signedDoc};
    delete docWithMissingPath.path;
    t.notOk(Val.documentIsValid(docWithMissingPath), 'missing path after signing');
    t.throws(() => Val.signDocument(keypair1, docWithMissingPath), 'missing path throws while signing');

    t.notOk(Val.documentIsValid(Val.signDocument(keypair1, {...doc1, author: 'a\nb'})), 'newline in author');
    t.notOk(Val.documentIsValid(Val.signDocument(keypair1, {...doc1, path: '\n'})), 'invalid path');
    t.notOk(Val.documentIsValid(Val.signDocument(keypair1, {...doc1, path: '/~'})), 'no write permission');

    t.notOk(Val.documentIsValid(Val.signDocument(keypair1, {...doc1, timestamp: -123}), now), 'timestamp negative');
    t.notOk(Val.documentIsValid(Val.signDocument(keypair1, {...doc1, timestamp: 0}), now), 'timestamp zero');
    t.notOk(Val.documentIsValid(Val.signDocument(keypair1, {...doc1, timestamp: now / 1000}), now), 'timestamp too small, probably in milliseconds');
    t.notOk(Val.documentIsValid(Val.signDocument(keypair1, {...doc1, timestamp: now + 3*DAY}), now), 'timestamp from the future');
    t.notOk(Val.documentIsValid(Val.signDocument(keypair1, {...doc1, timestamp: Number.MAX_SAFE_INTEGER + 10}), now), 'timestamp way too large');

    t.notOk(Val.documentIsValid(Val.signDocument(keypair1, {...doc1, timestamp: now + 5, deleteAfter: now + 3}), now), 'temporary document: timestamp and deleteAfter out of order');
    t.notOk(Val.documentIsValid(Val.signDocument(keypair1, {...doc1, timestamp: now - 7, deleteAfter: now - 3}), now), 'temporary document: just expired');
    t.ok(   Val.documentIsValid(Val.signDocument(keypair1, {...doc1, timestamp: now - 7, deleteAfter: now + 3}), now), 'temporary document: still good');
    t.ok(   Val.documentIsValid(Val.signDocument(keypair1, {...doc1, timestamp: now - 7, deleteAfter: now + 3 * DAY}), now), 'temporary document: definitely still good');

    // try various contents for the document
    let contentsAndValidity : [string, string, string][] = [
        // content, validity, note

        ['', 'VALID', 'empty string'],
        [snowmanJsString, 'VALID', 'snowman js string'],
        ['\x00\x00\x00', 'VALID', 'null bytes'],
        ['line1\nline2', 'VALID', 'newline'],

        [Buffer.from([97]) as any as string, 'THROWS', 'a buffer of "a"'],  // "a" as a buffer
        [Buffer.from([127, 128]) as any as string, 'THROWS', 'a buffer with invalid unicode'],  // invalid unicode
        [null as any as string, 'THROWS', 'null'],
        [123 as any as string, 'THROWS', 'a number'],
    ]
    for (let [content, validity, note] of contentsAndValidity) {
        if (validity === 'VALID' || validity === 'INVALID') {
            let doc2 = Val.signDocument(keypair1, {...doc1, content: content, contentHash: sha256(content)});
            t.same(Val.documentIsValid(doc2), validity === 'VALID', 'doc.content: ' + note);
        } else {
            t.throws(() => Val.signDocument(keypair1, {...doc1, content: content}), note);
        }
    }

    t.done();
});
