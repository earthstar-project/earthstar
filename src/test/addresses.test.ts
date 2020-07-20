import t = require('tap');
import {
    AuthorParsed,
    WorkspaceParsed,
    WorkspaceAddress,
    AuthorAddress,
} from '../util/types';
import {
    parseWorkspaceAddress,
    parseAuthorAddress,
} from '../util/addresses';
import { logTest } from '../util/log';

// use this unicode character for testing
let snowmanJsString = '☃';
let snowmanBufferUtf8 = Buffer.from([0xe2, 0x98, 0x83]);
let sparkleEmoji = '✨';

t.test('snowman test data', (t: any) => {
    t.same(Buffer.from(snowmanJsString, 'utf8'), snowmanBufferUtf8, 'snowman test data is good');
    t.end();
});

type WorkspaceVector = {
    note?: string,
    input: WorkspaceAddress,
    output: { workspaceParsed: WorkspaceParsed | null, err: string | boolean | null; },
};
t.test('parse workspace address', (t: any) => {
    let vectors : WorkspaceVector[] = [
        //----------------------------------------
        // normal cases
        {
            note: 'ok: regular invite-only address',
            input: '+solarpunk.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: {
                workspaceParsed: {
                    address: '+solarpunk.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
                    name: 'solarpunk',
                    pubkey: 'brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
                },
                err: null,
            }
        }, {
            note: 'ok: number in name',
            input: '+solar2000.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: {
                workspaceParsed: {
                    address: '+solar2000.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
                    name: 'solar2000',
                    pubkey: 'brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
                },
                err: null,
            }
        },

        //----------------------------------------
        // overall shape
        {
            note: 'x: empty string',
            input: '', 
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'x: no leading plus',
            input: 'solarpunk.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'x: leading slashes (old style)',
            input: '//solarpunk.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'x: empty key',
            input: '+solarpunk.',
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'x: no period or key',
            input: '+solarpunk',
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'x: just a word',
            input: 'solarpunk',
            output: { workspaceParsed: null, err: true, }
        },

        //----------------------------------------
        // characters
        {
            note: 'x: uppercase letters in name',
            input: '+solarPUNK.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'x: uppercase letters in pubkey',
            input: '+solarPunk.bRH7M3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'x: emoji in name',
            input: '+solar' + sparkleEmoji + '.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'x: snowman in name',
            input: '+solar' + snowmanJsString + '.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'x: newline in name',
            input: '+solar\npunk.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'x: newline in key',
            input: '+solarpunk.brh\n7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'x: ! in key',
            input: '+solarpunk.brh7\nm3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'x: space in name',
            input: '+solar punk.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'x: dash in name',
            input: '+solar-punk.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { workspaceParsed: null, err: true, }
        },

        //----------------------------------------
        // url-safety rules
        {
            note: 'x: name starts with number',
            input: '+0solarpunk.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'x: pubkey starts with number',
            input: '+solarpunk.7rh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { workspaceParsed: null, err: true, }
        },

        //----------------------------------------
        // periods
        {
            note: 'x: too many periods',
            input: '+solar.punk.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'x: no periods',
            input: '+solarpunkbrh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'x: no name',
            input: '+brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa', 
            output: { workspaceParsed: null, err: true, }
        },

        //----------------------------------------
        // name length
        {
            note: 'x: empty name',
            input: '+.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa', 
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'ok: name 1 char long',
            input: '+x.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa', 
            output: {
                workspaceParsed: {
                    address: '+x.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
                    name: 'x',
                    pubkey: 'brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
                },
                err: null,
            }
        }, {
            note: 'ok: name 15 chars long',
            input: '+aaaaabbbbbccccc.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa', 
            output: {
                workspaceParsed: {
                    address: '+aaaaabbbbbccccc.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
                    name: 'aaaaabbbbbccccc',
                    pubkey: 'brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
                },
                err: null,
            }
        }, {
            note: 'x: name 16 chars long',
            input: '+aaaaabbbbbcccccd.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa', 
            output: { workspaceParsed: null, err: true, }
        },
    ];
    for (let v of vectors) {
        let actualOutput = parseWorkspaceAddress(v.input);
        logTest(actualOutput);
        if (actualOutput.err) {
            t.same(!!v.output.err, !!actualOutput.err, 'workspace ' + v.note || 'vector should have error but does not');
        } else {
            logTest(actualOutput.err);
            t.same(v.output, actualOutput, 'workspace ' + v.note || 'vector should succeed');
        }
    }
    t.end();
});

type AuthorVector = {
    note?: string,
    input: AuthorAddress,
    output: { authorParsed: AuthorParsed | null, err: string | boolean | null; },
};
t.test('parse author address', (t: any) => {
    let vectors : AuthorVector[] = [
        //----------------------------------------
        // normal cases
        {
            note: 'ok: regular address',
            input: '@suzy.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: {
                authorParsed: {
                    address: '@suzy.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
                    shortname: 'suzy',
                    pubkey: 'brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
                },
                err: null,
            }
        },
        {
            note: 'ok: number in name',
            input: '@su99.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: {
                authorParsed: {
                    address: '@su99.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
                    shortname: 'su99',
                    pubkey: 'brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
                },
                err: null,
            }
        },

        //----------------------------------------
        // pubkey rules
        {
            note: 'x: pubkey one character too short',
            input: '@suzy.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowa',
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: pubkey one character too long',
            input: '@suzy.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaaa',
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: pubkey not starting with "b"',
            input: '@suzy.arh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { authorParsed: null, err: true, }
        },
        //----------------------------------------
        // url-safety rules
        {
            note: 'x: pubkey starts with number',
            input: '@suzy.7rh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: name starts with number',
            input: '@0uzy.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { authorParsed: null, err: true, }
        },

        //----------------------------------------
        // overall shape
        {
            note: 'x: empty string',
            input: '', 
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: no leading @',
            input: 'suzy.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: empty key',
            input: '@suzy.',
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: no key',
            input: '@suzy',
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: just a word',
            input: 'suzy',
            output: { authorParsed: null, err: true, }
        },

        //----------------------------------------
        // characters
        {
            note: 'x: uppercase letters in name',
            input: '+SUZY.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: uppercase letters in pubkey',
            input: '+suzy.bRH7M3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: emoji in name',
            input: '+suz' + sparkleEmoji + '.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: snowman in name',
            input: '+suz' + snowmanJsString + '.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: newline in name',
            input: '+su\nz.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: newline in key',
            input: '+suzy.brh7\nm3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: ! in key',
            input: '+suzy.brh7!m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: space in name',
            input: '+su z.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: dash in name',
            input: '+su-z.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { authorParsed: null, err: true, }
        },

        //----------------------------------------
        // periods
        {
            note: 'x: too many periods',
            input: '+suzy.foo.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: no periods',
            input: '+suzybrh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa',
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: no name',
            input: '+brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa', 
            output: { authorParsed: null, err: true, }
        },

        //----------------------------------------
        // name length
        {
            note: 'x: empty name',
            input: '+.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa', 
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: name 1 char long',
            input: '+a.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa', 
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: name 3 chars long',
            input: '+abc.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa', 
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: name 5 chars long',
            input: '+abcde.brh7m3unra5j5kx2luy64tbxccxawfp6gt5okdyf4mjkr2jywowaa', 
            output: { authorParsed: null, err: true, }
        }
    ];
    for (let v of vectors) {
        let actualOutput = parseAuthorAddress(v.input);
        if (actualOutput.err) {
            t.same(!!v.output.err, !!actualOutput.err, 'author ' + v.note || 'vector should have error but does not');
        } else {
            t.same(v.output, actualOutput, 'author ' + v.note || 'vector should succeed');
        }
    }
    t.end();
});
