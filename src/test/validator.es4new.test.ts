import t = require('tap');
//t.runOnly = true;

import {
    AuthorAddress,
    Document,
    AuthorParsed,
    WorkspaceParsed,
    WorkspaceAddress,
} from '../util/types';
import {
    generateAuthorKeypair,
    sha256,
} from '../crypto/crypto';
import {
    ValidatorNew_Es4,
    FUTURE_CUTOFF_MICROSECONDS,
} from '../validator/es4new';

let keypair1 = generateAuthorKeypair('test');
let author1: AuthorAddress = keypair1.address;
let keypair2 = generateAuthorKeypair('test');
let author2: AuthorAddress = keypair2.address;
let Val = ValidatorNew_Es4;

let snowmanJsString = '☃';
let snowmanBufferUtf8 = Buffer.from([0xe2, 0x98, 0x83]);
let snowmanJs2 = snowmanBufferUtf8.toString('utf8');
let snowmanU = '\u2603';
let sparkleEmoji = '✨';

let NOW = 1500000000000000;

// microseconds
let SEC = 1000 * 1000;
let MIN = SEC * 60;
let HOUR = MIN * 60;
let DAY = HOUR * 24;

//================================================================================

// Document properties
let stringFields = 'format workspace path contentHash content author signature'.split(' ');
let intFields = 'timestamp deleteAfter'.split(' ');
let optionalFields = ['deleteAfter'];
let allFields = stringFields.concat(intFields);
let requiredFields = allFields.filter(f => optionalFields.indexOf(f) === -1);

type Ob = {[key:string]: any};
let delProperty = (obj: Ob, name: string) : Ob => {
    let obj2 = {...obj};
    delete obj2[name];
    return obj2;
}

//================================================================================

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
    t.done();
});

t.test('signDocument and _assertAuthorSignatureIsValid', (t: any) => {
    let doc: Document = {
        format: 'es.4',
        workspace: '+gardenclub.xxxxxxxxxxxxxxxxxxxx',
        path: '/k1',
        contentHash: sha256('content1'),
        content: 'content1',
        timestamp: NOW - 10,
        deleteAfter: NOW + 10,
        author: author1,
        signature: '',
    };

    let signedDoc = Val.signDocument(keypair1, doc);
    t.doesNotThrow(() => Val._assertAuthorSignatureIsValid(signedDoc), 'signature is valid');
    t.doesNotThrow(() => Val.assertDocumentIsValid(signedDoc, NOW), 'doc is valid');

    t.throws(() => Val.signDocument(keypair2, doc), 'doc author must match keypair when signing');
    t.throws(() => Val._assertAuthorSignatureIsValid({...signedDoc, author: author2}), 'changing author after signing makes signature invalid');

    t.throws(() => Val._assertAuthorSignatureIsValid(doc), 'empty signature is invalid');
    t.throws(() => Val.assertDocumentIsValid(doc, NOW), 'doc without signature is invalid');

    for (let field of requiredFields) {
        let alteredDocPostSig = delProperty(signedDoc, field);
        t.throws(() => Val._assertAuthorSignatureIsValid(alteredDocPostSig as any), `deleting property makes signature invalid: ${field}`);
    }
    for (let field of stringFields) {
        // verifying content = contentHash is not done by _assertAuthorSignatureIsValid, it's done by _assertContentMatchesHash
        if (field === 'content') { continue; }

        t.throws(() => Val._assertAuthorSignatureIsValid({...signedDoc, [field]: 'a'}), `altering string property makes signature invalid: ${field}`);
    }
    for (let field of intFields) {
        t.throws(() => Val._assertAuthorSignatureIsValid({...signedDoc, [field]: (signedDoc as any)[field]-1}), `altering int property makes signature invalid: ${field}`);
    }

    t.done();
});

t.test('assertDocumentIsValid', (t: any) => {
    let doc: Document = {
        format: 'es.4',
        workspace: '+gardenclub.xxxxxxxxxxxxxxxxxxxx',
        path: '/k1',
        contentHash: sha256('content1'),
        content: 'content1',
        timestamp: NOW - 10,
        deleteAfter: NOW + 10,
        author: author1,
        signature: '',
    };

    let signedDoc = Val.signDocument(keypair1, doc);
    t.doesNotThrow(() => Val.assertDocumentIsValid(signedDoc, NOW), 'doc is valid');

    t.throws(() => Val.signDocument(keypair2, doc), 'doc author must match keypair when signing');

    t.throws(() => Val.assertDocumentIsValid(doc, NOW), 'doc without signature is invalid');
    t.throws(() => Val.assertDocumentIsValid({...signedDoc, content: 'abc'}, NOW), 'changing content makes doc invalid');
    t.throws(() => Val.assertDocumentIsValid({} as any, NOW), 'empty doc is invalid');
    t.throws(() => Val.assertDocumentIsValid({...signedDoc, extra: 'abc'} as any, NOW), 'extra property makes doc invalid');

    let doc2: Document = {
        format: 'es.4',
        workspace: '+gardenclub.xxxxxxxxxxxxxxxxxxxx',
        path: '/k1',
        contentHash: sha256('content1'),
        content: 'content1',
        timestamp: Date.now() * 1000,
        author: author1,
        signature: '',
    };
    let signedDoc2 = Val.signDocument(keypair1, doc2);
    t.doesNotThrow(() => Val.assertDocumentIsValid(signedDoc2), 'doc is valid when not supplying a value for NOW, and no deleteAfter');

    t.done();
});

type BasicValidityVector = {
    valid: boolean,
    doc: any,
    note?: string,
};
t.test('_assertBasicDocumentValidity', (t: any) => {
    let validDoc = {
            format: 'es.4',
            workspace: 'a',
            path: 'a',
            contentHash: 'a',
            content: 'a',  // TODO: test null content, once we allow that
            author: 'a',
            timestamp: 123,
            deleteAfter: 123,
            signature: 'a',
    };

    let vectors: BasicValidityVector[] = [
        { valid: true, doc: validDoc, note: 'basic valid doc' },
        { valid: true, doc: delProperty(validDoc, 'deleteAfter'), note: 'deleteAfter property is optional' },

        { valid: false, doc: null},
        { valid: false, doc: undefined},
        { valid: false, doc: true},
        { valid: false, doc: false},
        { valid: false, doc: []},
        { valid: false, doc: {}},
        { valid: false, doc: ''},
        { valid: false, doc: 'hello'},

        { valid: false, doc: {...validDoc, extra: 'a'}, note: 'extra property' },
        { valid: false, doc: {...validDoc, format: '???'}, note: 'unknown format' },
    ];

    for (let field of allFields) {
        vectors.push({ valid: false, doc: {...validDoc, [field]: null}, note: `${field} = null` });
        vectors.push({ valid: false, doc: {...validDoc, [field]: undefined}, note: `${field} = undefined` });
        vectors.push({ valid: false, doc: {...validDoc, [field]: true}, note: `${field} = true` });
        vectors.push({ valid: false, doc: {...validDoc, [field]: false}, note: `${field} = false` });
        vectors.push({ valid: false, doc: {...validDoc, [field]: []}, note: `${field} = []` });
        vectors.push({ valid: false, doc: {...validDoc, [field]: {}}, note: `${field} = {}` });

        let isOptional = optionalFields.indexOf(field) !== -1;
        vectors.push({ valid: isOptional, doc: delProperty(validDoc, field), note: `${field} is missing` });

        if (stringFields.indexOf(field) !== -1) {
            vectors.push({ valid: false, doc: {...validDoc, [field]: 123}, note: `${field} = 123` });
            vectors.push({ valid: false, doc: {...validDoc, [field]: 123.4}, note: `${field} = 123.4` });
        }
        if (intFields.indexOf(field) !== -1) {
            vectors.push({ valid: false, doc: {...validDoc, [field]: 'a'}, note: `${field} = 'a'` });
        }
    }

    for (let v of vectors) {
        let testMethod = v.valid ? t.doesNotThrow : t.throws;
        testMethod(() => Val._assertBasicDocumentValidity(v.doc),
            (v.valid ? 'valid doc: ' : 'invalid doc: ') +
            (v.note || JSON.stringify(v.doc))
        );
    }
    t.end();
});

type AuthorCanWriteVector = {
    canWrite: boolean,
    author: AuthorAddress,
    path: string,
    note?: string,
};
t.test('_assertAuthorCanWriteToPath', (t: any) => {
    let vectors: AuthorCanWriteVector[] = [
        { canWrite: true, author: author1, path: '/abc', note: 'a public path' },
        { canWrite: true, author: author1, path: `/${author1}/abc`, note: 'a public path with author name but no tilde' },
        { canWrite: true, author: author1, path: `/~${author1}/abc`, note: 'a private path' },
        { canWrite: true, author: author1, path: `/~${author1}~${author2}/abc`, note: 'a private path of two authors' },

        { canWrite: false, author: author1, path: `/~/abc`, note: 'a path with just a tilde - nobody can write here' },
        { canWrite: false, author: author1, path: `/~${author2}/abc`, note: "another author's path" },
        { canWrite: false, author: author1, path: `/~/${author1}/abc`, note: 'tilde not touching author address' },
    ];
    for (let v of vectors) {
        let testMethod = v.canWrite ? t.doesNotThrow : t.throws;
        testMethod(() => Val._assertAuthorCanWriteToPath(v.author, v.path),
            ((v.canWrite ? 'author can write to' : "author can't write to")
            + (v.note ? ` ${v.note}` : '')
            /*+ ': ' + v.path*/)
        );
    }
    t.end();
});

type TimestampIsOkVector = {
    valid: boolean,
    timestamp: number,
    deleteAfter?: number,
    now: number,
    note?: string,
};
t.test('_assertTimestampIsOk', (t: any) => {
    let MAX_TIMESTAMP = 9007199254740991;
    let MIN_TIMESTAMP = 10000000000000;
    let vectors: TimestampIsOkVector[] = [
        { valid: true, timestamp: NOW, now: NOW, note: 'timestamp == NOW' },
        { valid: true, timestamp: NOW + 1, now: NOW, note: 'timestamp == NOW + 1' },
        { valid: true, timestamp: NOW - 1, now: NOW, note: 'timestamp == NOW - 1' },

        { valid: false, timestamp: NOW - 0.2, now: NOW, note: 'non-integer timestamp' },
        { valid: false, timestamp: NaN, now: NOW, note: 'NaN timestamp' },
        { valid: false, timestamp: null as any, now: NOW, note: 'null timestamp' },
        { valid: false, timestamp: undefined as any, now: NOW, note: 'undefined timestamp' },
        { valid: false, timestamp: false as any, now: NOW, note: 'false timestamp' },
        { valid: false, timestamp: true as any, now: NOW, note: 'true timestamp' },
        { valid: false, timestamp: ('' + NOW) as any, now: NOW, note: 'string timestamp' },

        { valid: false, timestamp: -1, now: NOW, note: 'negative timestamp' },
        { valid: false, timestamp: 0, now: NOW, note: 'zero timestamp' },
        { valid: false, timestamp: Date.now(), now: NOW, note: 'timestamp in ms' },
        { valid: false, timestamp: Math.floor(Date.now() / 1000), now: NOW, note: 'timestamp in seconds' },

        { valid: false, timestamp: MIN_TIMESTAMP-1, now: NOW, note: 'timestamp too small' },
        { valid: true, timestamp: MIN_TIMESTAMP, now: NOW, note: 'timestamp just large enough' },
        { valid: true, timestamp: MAX_TIMESTAMP, now: MAX_TIMESTAMP+10, note: 'timestamp almost too large' },
        { valid: false, timestamp: MAX_TIMESTAMP+1, now: MAX_TIMESTAMP+10, note: 'timestamp too large' },

        { valid: true, timestamp: NOW + FUTURE_CUTOFF_MICROSECONDS - 1, now: NOW, note: 'timestamp from the near future' },
        { valid: false, timestamp: NOW + FUTURE_CUTOFF_MICROSECONDS + 1, now: NOW, note: 'timestamp from the far future' },

        { valid: true, timestamp: NOW - 5, deleteAfter: NOW + 5, now: NOW, note: 'living ephemeral doc' },
        { valid: false, timestamp: NOW + 8, deleteAfter: NOW + 5, now: NOW, note: 'jumbled ephemeral doc (deleteAfter before timestamp)' },
        { valid: false, timestamp: NOW - 5, deleteAfter: NOW - 1, now: NOW, note: 'expired ephemeral doc' },

        // deleteAfter
        { valid: false, timestamp: NOW, deleteAfter: NOW - 0.2, now: NOW, note: 'non-integer deleteAfter' },
        { valid: false, timestamp: NOW, deleteAfter: NaN, now: NOW, note: 'NaN deleteAfter' },
        { valid: false, timestamp: NOW, deleteAfter: null as any, now: NOW, note: 'null deleteAfter' },
        { valid: true, timestamp: NOW, deleteAfter: undefined as any, now: NOW, note: 'undefined deleteAfter' }, // undefined is ok, though normally it should be missing
        { valid: false, timestamp: NOW, deleteAfter: false as any, now: NOW, note: 'false deleteAfter' },
        { valid: false, timestamp: NOW, deleteAfter: true as any, now: NOW, note: 'true deleteAfter' },
        { valid: false, timestamp: NOW, deleteAfter: ('' + NOW) as any, now: NOW, note: 'string deleteAfter' },

        { valid: false, timestamp: NOW, deleteAfter: -1, now: NOW, note: 'negative deleteAfter' },
        { valid: false, timestamp: NOW, deleteAfter: 0, now: NOW, note: 'zero deleteAfter' },
        { valid: false, timestamp: NOW, deleteAfter: Date.now(), now: NOW, note: 'deleteAfter in ms' },
        { valid: false, timestamp: NOW, deleteAfter: Math.floor(Date.now() / 1000), now: NOW, note: 'deleteAfter in seconds' },

        { valid: false, timestamp: NOW, deleteAfter: MIN_TIMESTAMP - 1, now: NOW, note: 'deleteAfter too small' },
        { valid: true,  timestamp: MIN_TIMESTAMP, deleteAfter: MIN_TIMESTAMP + 1, now: MIN_TIMESTAMP, note: 'deleteAfter just large enough' },
        { valid: true,  timestamp: NOW, deleteAfter: MAX_TIMESTAMP, now: NOW, note: 'deleteAfter almost too large' },
        { valid: false, timestamp: NOW, deleteAfter: MAX_TIMESTAMP+1, now: NOW, note: 'deleteAfter too large' },
    ];
    for (let v of vectors) {
        let testMethod = v.valid ? t.doesNotThrow : t.throws;
        testMethod(() => Val._assertTimestampIsOk(v.timestamp, v.deleteAfter, v.now),
            (v.valid ? 'valid times: ' : 'invalid times: ')
            + (v.note ? v.note : '')
        );
    }
    t.end();
});

type IsValidPathVector = {
    valid: boolean,
    path: string,
    note?: string,
};
t.test('_assertPathIsValid', (t: any) => {
    let vectors: IsValidPathVector[] = [
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
        { valid: false, path: '/question-mark?' },
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
        { valid: true, path: '/\'()-._~!*$&+,:=@%', note: 'all allowed punctuation characters' },
    ];
    for (let v of vectors) {
        let testMethod = v.valid ? t.doesNotThrow : t.throws;
        testMethod(() => Val._assertPathIsValid(v.path),
            `${v.valid ? 'valid' : 'invalid'} path: ${JSON.stringify(v.path)}  ${v.note || ''}`
        );
    }
    t.end();
});

type AuthorAddressVector = {
    valid: boolean,
    address: AuthorAddress,
    parsed?: AuthorParsed,
    note?: string,
};
t.test('parseAuthorAddress', (t: any) => {
    let vectors: AuthorAddressVector[] = [
        {
            valid: true,
            address: '@suzy.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
            parsed: {
                address: '@suzy.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
                shortname: 'suzy',
                pubkey: 'bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
            },
            note: 'normal address',
        },
        {
            valid: true,
            address: '@s999.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
            parsed: {
                address: '@s999.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
                shortname: 's999',
                pubkey: 'bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
            },
            note: 'normal address, name contains number but does not start with number',
        },
        { valid: false, address: '', note: 'empty string' },
        { valid: false, address: '@', note: 'just a @' },
        { valid: false, address: 'suzy.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'no @' },
        { valid: false, address: '+suzy.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'starts with +' },
        { valid: false, address: '@suzy.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'key too short (52 chars)' },
        { valid: false, address: '@suzy.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'key too long (54 chars)' },
        { valid: false, address: '@suzybxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'no period' },
        { valid: false, address: '@suzy.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.extra', note: 'too many periods' },
        { valid: false, address: '@suz.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'name too short' },
        { valid: false, address: '@suzyy.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'name too long' },
        { valid: false, address: '@.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'no name' },
        { valid: false, address: '@bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'just a key' },
        { valid: false, address: '@suzy.', note: 'no key' },
        { valid: false, address: '@suzy', note: 'just a name' },
        { valid: false, address: 'suzy', note: 'just a word' },
        { valid: false, address: ' @suzy.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'leading space' },
        { valid: false, address: '@suzy.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx ', note: 'trailing space' },
        { valid: false, address: '@suzy.bxxxxxxxxxxxxxxxx xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'space in the middle' },
        { valid: false, address: '@SUZY.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'capital name' },
        { valid: false, address: '@suzy.bXXXXXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'capital key' },
        { valid: false, address: '@suzy.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'key without leading b (53 chars)' },
        { valid: false, address: '@suzy.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'key without leading b (52 chars)' },
        { valid: false, address: '@1uzy.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'name starts with number' },
        { valid: false, address: '@su?y.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'question mark in name' },
        { valid: false, address: '@su y.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'space in name' },
        { valid: false, address: '@su\ny.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'newline in name' },
        { valid: false, address: '@su-y.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'dash in name' },
        { valid: false, address: '@su_y.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'underscore in name' },
        { valid: false, address: '@su+y.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: '+ in middle of name' },
        { valid: false, address: '@suzy.bxxxxxx+xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: '+ in middle of key' },
        { valid: false, address: '@su@y.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: '@ in middle of name' },
        { valid: false, address: '@suzy.bxxxxxx@xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: '@ in middle of key' },
        { valid: false, address: '@suzy.bx?xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'question mark in key' },
        { valid: false, address: '@@suzy.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'double @ + 4 letter name' },
        { valid: false, address: '@@uzy.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'double @ + 3 letter name' },
        { valid: false, address: `@suz${snowmanJsString}.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`, note: 'snowman in name + 3 letters' },
        { valid: false, address: `@su${snowmanJsString}.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`, note: 'snowman in name + 2 letters' },
        { valid: false, address: `@s${snowmanJsString}.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`, note: 'snowman in name + 1 letter' },

        // TODO: more carefully check b32 characters
        //{ valid: false, address: '@suzy.b01xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'invalid b32 characters in key (0, 1)' },
    ];
    for (let v of vectors) {
        if (v.valid) {
            t.same(Val.parseAuthorAddress(v.address), v.parsed,       'should be parsable: ' + (v.note || v.address));
            t.doesNotThrow(() => Val._assertAuthorIsValid(v.address), 'should be valid:    ' + (v.note || v.address));
        } else {
            t.throws(() => Val.parseAuthorAddress(v.address),   'should be unparsable: ' + (v.note || v.address));
            t.throws(() => Val._assertAuthorIsValid(v.address), 'should be invalid:    ' + (v.note || v.address));
        }
    }
    t.end();
});

type WorkspaceAddressVector = {
    valid: boolean,
    address: WorkspaceAddress,
    parsed?: WorkspaceParsed,
    note?: string,
};
t.test('parseWorkspaceAddress', (t: any) => {
    let vectors: WorkspaceAddressVector[] = [
        {
            valid: true,
            address: '+gardening.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
            parsed: {
                address: '+gardening.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
                name: 'gardening',
                pubkey: 'bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
            },
            note: 'normal address with long b32 pubkey',
        },
        {
            valid: true,
            address: '+gardening.bxxxx',
            parsed: {
                address: '+gardening.bxxxx',
                name: 'gardening',
                pubkey: 'bxxxx',
            },
            note: 'normal address with short random b32',
        },
        {
            valid: true,
            address: '+a.b',
            parsed: {
                address: '+a.b',
                name: 'a',
                pubkey: 'b',
            },
            note: 'normal address with 1 character name and 1 character key starting with b',
        },
        {
            valid: true,
            address: '+a.x',
            parsed: {
                address: '+a.x',
                name: 'a',
                pubkey: 'x',
            },
            note: 'normal address with 1 character name and 1 character key not starting with b',
        },
        {
            valid: true,
            address: '+aaaaabbbbbccccc.bxxxx',
            parsed: {
                address: '+aaaaabbbbbccccc.bxxxx',
                name: 'aaaaabbbbbccccc',
                pubkey: 'bxxxx',
            },
            note: 'normal address with 15 character name',
        },
        {
            valid: true,
            address: '+gardening.r0cks',  // note that zero is not in the b32 character set
            parsed: {
                address: '+gardening.r0cks',
                name: 'gardening',
                pubkey: 'r0cks',
            },
            note: 'normal address with word after period (non-b32)',
        },
        {
            valid: true,
            address: '+garden2000.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
            parsed: {
                address: '+garden2000.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
                name: 'garden2000',
                pubkey: 'bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
            },
            note: 'normal address with long pubkey, name contains number but does not start with number',
        },
        { valid: false, address: '', note: 'empty string' },
        { valid: false, address: '+', note: 'just a +' },
        { valid: false, address: 'gardening.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'no +' },
        { valid: false, address: '@gardening.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'starts with @' },
        { valid: false, address: '+gardening.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'key too long (54 chars)' },
        { valid: false, address: '+gardeningbxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'no period' },
        { valid: false, address: '+gardening.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.extra', note: 'too many periods' },
        { valid: false, address: '+aaaaabbbbbcccccd.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'name too long (16 characters)' },
        { valid: false, address: '+.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'no name' },
        { valid: false, address: '+bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'just a key' },
        { valid: false, address: '+gardening.', note: 'no key' },
        { valid: false, address: '+gardening', note: 'just a name' },
        { valid: false, address: 'gardening', note: 'just a word' },
        { valid: false, address: ' +gardening.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'leading space' },
        { valid: false, address: '+gardening.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx ', note: 'trailing space' },
        { valid: false, address: '+gardening.bxxxxxxxxxxxxxxxx xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'space in the middle' },
        { valid: false, address: '+GARDENING.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'capital name' },
        { valid: false, address: '+gardening.bXXXXXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'capital key' },
        { valid: false, address: '+1garden.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'name starts with number' },
        { valid: false, address: '+gar?dening.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'question mark in name' },
        { valid: false, address: '+gar den.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'space in name' },
        { valid: false, address: '+gar\nden.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'newline in name' },
        { valid: false, address: '+gar-den.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'dash in name' },
        { valid: false, address: '+gar_den.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'underscore in name' },
        { valid: false, address: '+gar+den.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: '+ in middle of name' },
        { valid: false, address: '+garden.bxx+xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: '+ in middle of key' },
        { valid: false, address: '+gar@den.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: '@ in middle of name' },
        { valid: false, address: '+garden.bxx@xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: '@ in middle of key' },
        { valid: false, address: '+gardening.bx?xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'question mark in key' },
        { valid: false, address: '++gardening.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'double +' },
        { valid: false, address: `+garden${snowmanJsString}.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`, note: 'snowman in name' },
    ];
    for (let v of vectors) {
        if (v.valid) {
            t.same(Val.parseWorkspaceAddress(v.address), v.parsed,       'should be parsable: ' + (v.note || v.address));
            t.doesNotThrow(() => Val._assertWorkspaceIsValid(v.address), 'should be valid:    ' + (v.note || v.address));
        } else {
            t.throws(() => Val.parseWorkspaceAddress(v.address),   'should be unparsable: ' + (v.note || v.address));
            t.throws(() => Val._assertWorkspaceIsValid(v.address), 'should be invalid:    ' + (v.note || v.address));
        }
    }
    t.end();
});

type ContentMatchesHashVector = {
    valid: boolean,
    content: string,
    contentHash: string,
    note?: string,
};
t.test('_assertContentMatchesHash', (t: any) => {
    let vectors: ContentMatchesHashVector[] = [
        { valid: true, content: '', contentHash: sha256('') },
        { valid: true, content: 'abc', contentHash: sha256('abc') },
        { valid: true, content: 'a\nb', contentHash: sha256('a\nb') },
        { valid: true, content: snowmanJsString, contentHash: sha256(snowmanJsString) },

        { valid: false, content: '', contentHash: '' },
        { valid: false, content: 'hello', contentHash: sha256('abc') },
    ];
    for (let v of vectors) {
        let testMethod = v.valid ? t.doesNotThrow : t.throws;
        testMethod(() => Val._assertContentMatchesHash(v.content, v.contentHash),
            `${v.valid ? 'content matches hash' : 'content does not match hash'} ${JSON.stringify(v.contentHash)}  ${v.note || ''}`
        );
    }
    t.end();
});
