import t = require('tap');
//t.runOnly = true;

import {
    AuthorAddress,
    AuthorKeypair,
    AuthorParsed,
    Document,
    ValidationError,
    WorkspaceAddress,
    WorkspaceParsed,
    isErr,
    notErr,
} from '../util/types';
import {
    stringMult
} from '../util/helpers';
import {
    generateAuthorKeypair,
    sha256base32,
} from '../crypto/crypto';
import {
    ValidatorEs4,
    FUTURE_CUTOFF_MICROSECONDS,
} from '../validator/es4';

let keypair1 = generateAuthorKeypair('test') as AuthorKeypair;
let keypair2 = generateAuthorKeypair('test') as AuthorKeypair;
if (isErr(keypair1)) { throw "oops"; }
if (isErr(keypair2)) { throw "oops"; }
let author1 = keypair1.address;
let author2 = keypair2.address;
let Val = ValidatorEs4;

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
let nullableFields = ['deleteAfter'];
let allFields = stringFields.concat(intFields);

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
        contentHash: sha256base32('content1'),
        content: 'content1',
        timestamp: 1,
        deleteAfter: null,
        author: '@suzy.xxxxxxxxxxx',
        signature: 'xxxxxxxxxxxxx',
    };
    t.equal(Val.hashDocument(doc1), 'bz6ye6gvzo7w6igkht3qqn4jvrp5qehvcmo5kyp3gldnbbmdy7vdq', 'expected document hash, deleteAfter null');
    let doc2: Document = {
        format: 'es.4',
        workspace: '+gardenclub.xxxxxxxxxxxxxxxxxxxx',
        path: '/path1',
        contentHash: sha256base32('content1'),
        content: 'content1',
        timestamp: 1,
        deleteAfter: 2,  // with deleteAfter
        author: '@suzy.xxxxxxxxxxx',
        signature: 'xxxxxxxxxxxxx',
    };
    t.equal(Val.hashDocument(doc2), 'bl3yoc4h4iubuev5izxr4trnxrfhnmdoqy2uciajq73quvu22vyna', 'expected document hash, with deleteAfter');
    t.end();
});

t.test('signDocument and _checkAuthorSignatureIsValid', (t: any) => {
    let doc: Document = {
        format: 'es.4',
        workspace: '+gardenclub.xxxxxxxxxxxxxxxxxxxx',
        path: '/k1!',
        contentHash: sha256base32('content1'),
        content: 'content1',
        timestamp: NOW - 10,
        deleteAfter: NOW + 10,
        author: author1,
        signature: '',
    };

    let signedDocOrErr = Val.signDocument(keypair1, doc);
    if (isErr(signedDocOrErr)) {
        t.ok(false, 'signature failed but should have succeeded: ' + signedDocOrErr.message);
        t.end();
        return;
    }
    let signedDoc = signedDocOrErr; // this helps typescript get rid of the possible error type :(

    t.ok(notErr(Val._checkAuthorSignatureIsValid(signedDoc)), 'signature is valid');
    t.ok(notErr(Val.checkDocumentIsValid(signedDoc, NOW)), 'doc is valid');

    t.ok(Val.signDocument(keypair2, doc) instanceof ValidationError,
        'doc author must match keypair when signing');
    t.ok(Val._checkAuthorSignatureIsValid({...signedDoc, author: author2}) instanceof ValidationError,
        'changing author after signing makes signature invalid');

    t.ok(Val._checkAuthorSignatureIsValid(doc) instanceof ValidationError, 'empty signature is invalid');
    t.ok(Val.checkDocumentIsValid(doc, NOW) instanceof ValidationError, 'doc without signature is invalid');

    for (let field of allFields) {
        let alteredDocPostSig = delProperty(signedDoc, field);
        t.ok(Val._checkAuthorSignatureIsValid(alteredDocPostSig as any) instanceof ValidationError,
            `deleting property makes signature invalid: ${field}`);
    }
    for (let field of stringFields) {
        // verifying content = contentHash is not done by _checkAuthorSignatureIsValid, it's done by _checkContentMatchesHash,
        // so skip that field here
        if (field === 'content') { continue; }

        t.ok(Val._checkAuthorSignatureIsValid({...signedDoc, [field]: 'a'}) instanceof ValidationError,
            `altering string property makes signature invalid: ${field}`);
    }
    for (let field of intFields) {
        t.ok(Val._checkAuthorSignatureIsValid({...signedDoc, [field]: (signedDoc as any)[field]-1}) instanceof ValidationError,
            `altering int property makes signature invalid: ${field}`);
    }

    t.end();
});

t.test('checkDocumentIsValid', (t: any) => {
    let ephDoc: Document = {
        format: 'es.4',
        workspace: '+gardenclub.xxxxxxxxxxxxxxxxxxxx',
        path: '/k1!',
        contentHash: sha256base32('content1'),
        content: 'content1',
        timestamp: NOW - 10,
        deleteAfter: NOW + 10,
        author: author1,
        signature: '',
    };

    let signedDocOrErr = Val.signDocument(keypair1, ephDoc);
    if (isErr(signedDocOrErr)) {
        t.ok(false, 'signature failed but should have succeeded: ' + signedDocOrErr.message);
        t.end();
        return;
    }
    let signedDoc = signedDocOrErr; // this helps typescript get rid of the possible error type :(

    t.ok(Val.checkDocumentIsValid(signedDoc, NOW) === true, 'doc is valid');

    t.ok(Val.signDocument(keypair2, ephDoc) instanceof ValidationError, 'doc author must match keypair when signing');

    t.ok(Val.checkDocumentIsValid(ephDoc, NOW) instanceof ValidationError, 'doc without signature is invalid');
    t.ok(Val.checkDocumentIsValid({...signedDoc, content: 'abc'}, NOW) instanceof ValidationError, 'changing content after signing makes doc invalid');
    t.ok(Val.checkDocumentIsValid({} as any, NOW) instanceof ValidationError, 'empty doc is invalid');
    t.ok(Val.checkDocumentIsValid({...signedDoc, extra: 'abc'} as any, NOW) instanceof ValidationError, 'extra property makes doc invalid');

    let regDoc: Document = {
        format: 'es.4',
        workspace: '+gardenclub.xxxxxxxxxxxxxxxxxxxx',
        path: '/k1',
        contentHash: sha256base32('content1'),
        content: 'content1',
        timestamp: Date.now() * 1000,
        deleteAfter: null,
        author: author1,
        signature: '',
    };
    let signedDoc2 = Val.signDocument(keypair1, regDoc);
    t.ok(notErr(signedDoc2), 'signature succeeded');
    t.ok(Val.checkDocumentIsValid(signedDoc2 as Document) === true, 'doc is valid when not supplying a value for NOW, and no deleteAfter');

    t.end();
});

type BasicValidityVector = {
    valid: boolean,
    doc: any,
    note?: string,
};
t.test('_checkBasicDocumentValidity', (t: any) => {
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
        { valid: true, doc: {...validDoc, deleteAfter: null}, note: 'deleteAfter: null is valid' },

        { valid: false, doc: null},
        { valid: false, doc: undefined},
        { valid: false, doc: true},
        { valid: false, doc: false},
        { valid: false, doc: []},
        { valid: false, doc: {}},
        { valid: false, doc: ''},
        { valid: false, doc: 'hello'},

        { valid: false, doc: delProperty(validDoc, 'deleteAfter'), note: 'deleteAfter property is required' },
        { valid: false, doc: {...validDoc, extra: 'a'}, note: 'extra property is invalid' },
        { valid: false, doc: {...validDoc, format: '???'}, note: 'unknown format is invalid' },
    ];

    for (let field of allFields) {
        // no fields can have these values: undefined, true, false, [], {}
        vectors.push({ valid: false, doc: {...validDoc, [field]: undefined}, note: `${field} = undefined` });
        vectors.push({ valid: false, doc: {...validDoc, [field]: true}, note: `${field} = true` });
        vectors.push({ valid: false, doc: {...validDoc, [field]: false}, note: `${field} = false` });
        vectors.push({ valid: false, doc: {...validDoc, [field]: []}, note: `${field} = []` });
        vectors.push({ valid: false, doc: {...validDoc, [field]: {}}, note: `${field} = {}` });

        // only nullable fields can be null
        let isNullable = nullableFields.indexOf(field) !== -1;
        vectors.push({ valid: isNullable, doc: {...validDoc, [field]: null }, note: `${field} is null` });

        // no fields can be missing
        vectors.push({ valid: false, doc: delProperty(validDoc, field), note: `${field} is missing` });

        if (stringFields.indexOf(field) !== -1) {
            // string fields can't be numbers
            vectors.push({ valid: false, doc: {...validDoc, [field]: 123}, note: `${field} = 123` });
            vectors.push({ valid: false, doc: {...validDoc, [field]: 123.4}, note: `${field} = 123.4` });
        }
        if (intFields.indexOf(field) !== -1) {
            // int fields can't be strings, NaN, or floats
            vectors.push({ valid: false, doc: {...validDoc, [field]: 'a'}, note: `${field} = 'a'` });
            vectors.push({ valid: false, doc: {...validDoc, [field]: NaN}, note: `${field} = NaN` });
            vectors.push({ valid: false, doc: {...validDoc, [field]: (validDoc as any)[field] + 0.1}, note: `${field} = float` });
        }
    }

    for (let v of vectors) {
        let testMethod = v.valid ? t.true : t.false;
        testMethod(notErr(Val._checkBasicDocumentValidity(v.doc)),
            (v.valid ? 'valid' : 'invalid') + ' doc: ' + (v.note || JSON.stringify(v.doc))
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
t.test('_checkAuthorCanWriteToPath', (t: any) => {
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
        let testMethod = v.canWrite ? t.true : t.false;
        testMethod(notErr(Val._checkAuthorCanWriteToPath(v.author, v.path)),
            `author ${v.canWrite ? 'can' : "can't"} write` + (v.note ? ' to ' + v.note : '')
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
t.test('_checkTimestampIsOk', (t: any) => {
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

        // deleteAfter
        { valid: true, timestamp: NOW - 5, deleteAfter: NOW + 5, now: NOW, note: 'living ephemeral doc' },
        { valid: false, timestamp: NOW + 8, deleteAfter: NOW + 5, now: NOW, note: 'jumbled ephemeral doc (deleteAfter before timestamp)' },
        { valid: false, timestamp: NOW - 5, deleteAfter: NOW - 1, now: NOW, note: 'expired ephemeral doc' },

        { valid: true,  timestamp: NOW, deleteAfter: null as any, now: NOW, note: 'null deleteAfter is ok' },
        { valid: false, timestamp: NOW, deleteAfter: NOW - 0.2, now: NOW, note: 'non-integer deleteAfter' },
        { valid: false, timestamp: NOW, deleteAfter: NaN, now: NOW, note: 'NaN deleteAfter' },
        { valid: false, timestamp: NOW, deleteAfter: undefined as any, now: NOW, note: 'undefined deleteAfter' },
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
        let testMethod = v.valid ? t.true : t.false;
        testMethod(notErr(Val._checkTimestampIsOk(v.timestamp, 'deleteAfter' in v ? (v.deleteAfter as number) : null, v.now)),
            (v.valid ? 'valid times: ' : 'invalid times: ')
            + (v.note ? v.note : '')
        );
    }
    t.end();
});

type IsValidPathVector = {
    valid: boolean,
    path: string,
    deleteAfter?: number | null,
    note?: string,
};
t.test('_checkPathIsValid', (t: any) => {
    let vectors: IsValidPathVector[] = [
        // valid
        { valid: true, path: '/foo' },
        { valid: true, path: '/FOO', note: 'uppercase' },
        { valid: true, path: '/1234/5678', note: 'digits' },
        { valid: true, path: '/a/b/c/d/e/f/g/h' },
        { valid: true, path: '/about/~@suzy.abc/name' },
        { valid: true, path: '/wiki/shared/Garden%20Gnome' },
        { valid: true, path: '/\'()-._~!*$&+,:=@%', note: 'all allowed punctuation characters' },

        // ephemeral documents and '!'
        { valid: true, path: '/foo', deleteAfter: null, note: 'proper regular path with no !' },
        { valid: false, path: '/foo!', deleteAfter: null, note: 'bad: regular doc with !' },
        { valid: false, path: '/foo!!', deleteAfter: null, note: 'bad: regular doc with !!' },
        { valid: false, path: '/!foo', deleteAfter: null, note: 'bad: regular doc with !' },

        { valid: false, path: '/foo', deleteAfter: 123, note: 'bad: ephemeral doc but no !' },
        { valid: true, path: '/foo!', deleteAfter: 123 , note: 'proper ephemeral path with !'},
        { valid: true, path: '/foo!!', deleteAfter: 123 , note: 'proper ephemeral path with !!'},
        { valid: true, path: '/!foo', deleteAfter: 123 , note: 'proper ephemeral path with !'},

        // length
        { valid: true, path: '/' + stringMult('a', 511), note: '512 characters is allowed' },
        { valid: false, path: '/' + stringMult('a', 512), note: '513 characters is too long' },

        // invalid
        { valid: false, path: '', note: 'empty string' },
        { valid: false, path: ' ', note: 'just a space' },
        { valid: false, path: '\x00', note: 'null byte' },
        { valid: false, path: '/', note: 'just one slash' },
        { valid: false, path: 'a', note: 'just one letter' },
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

    ];
    for (let v of vectors) {
        let testMethod = v.valid ? t.true : t.false;
        testMethod(notErr(Val._checkPathIsValid(v.path, v.deleteAfter)),
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
        { valid: false, address: '@suzy.b01xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', note: 'invalid b32 characters in key (0, 1)' },
    ];
    for (let v of vectors) {
        if (v.valid) {
            t.same(Val.parseAuthorAddress(v.address), v.parsed, 'should be parsable: ' + (v.note || v.address));
            t.ok(notErr(Val._checkAuthorIsValid(v.address)),    'should be valid:    ' + (v.note || v.address));
        } else {
            t.ok(isErr(Val.parseAuthorAddress(v.address)),  'should be unparsable: ' + (v.note || v.address));
            t.ok(isErr(Val._checkAuthorIsValid(v.address)), 'should be invalid:    ' + (v.note || v.address));
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
            t.same(Val.parseWorkspaceAddress(v.address), v.parsed, 'should be parsable: ' + (v.note || v.address));
            t.ok(notErr(Val._checkWorkspaceIsValid(v.address)),    'should be valid:    ' + (v.note || v.address));
        } else {
            t.ok(isErr(Val.parseWorkspaceAddress(v.address)),  'should be unparsable: ' + (v.note || v.address));
            t.ok(isErr(Val._checkWorkspaceIsValid(v.address)), 'should be invalid:    ' + (v.note || v.address));
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
t.test('_checkContentMatchesHash', (t: any) => {
    let vectors: ContentMatchesHashVector[] = [
        { valid: true, content: '', contentHash: sha256base32('') },
        { valid: true, content: 'abc', contentHash: sha256base32('abc') },
        { valid: true, content: 'a\nb', contentHash: sha256base32('a\nb') },
        { valid: true, content: snowmanJsString, contentHash: sha256base32(snowmanJsString) },

        { valid: false, content: '', contentHash: '' },
        { valid: false, content: 'hello', contentHash: sha256base32('abc') },
    ];
    for (let v of vectors) {
        let testMethod = v.valid ? t.true : t.false;
        testMethod(notErr(Val._checkContentMatchesHash(v.content, v.contentHash)),
            `${v.valid ? 'content matches hash' : 'content does not match hash'} ${JSON.stringify(v.contentHash)}  ${v.note || ''}`
        );
    }
    t.end();
});
