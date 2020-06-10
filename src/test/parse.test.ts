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

let log = console.log;

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
            note: 'ok: regular address',
            input: '//solarpunk.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
            output: {
                workspaceParsed: {
                    address: '//solarpunk.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
                    name: 'solarpunk',
                    pubkey: '2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
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
            note: 'x: no leading slashes',
            input: 'solarpunk.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'x: empty key',
            input: '//solarpunk.',
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'x: no key',
            input: '//solarpunk',
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
            input: '//solarPUNK.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'x: emoji in name',
            input: '//solar' + sparkleEmoji + '.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'x: snowman in name',
            input: '//solar' + snowmanJsString + '.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'x: newline in name',
            input: '//solar\npunk.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'x: newline in key',
            input: '//solarpunk.2F2jmsq\nfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'x: ! in key',
            input: '//solarpunk.2!2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'x: space in name',
            input: '//solar punk.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'x: dash in name',
            input: '//solar-punk.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'x: number in name',
            input: '//solar0000.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
            output: { workspaceParsed: null, err: true, }
        },

        //----------------------------------------
        // periods
        {
            note: 'x: too many periods',
            input: '//solar.punk.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'x: no periods',
            input: '//solarpunk2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'x: no name',
            input: '//2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW', 
            output: { workspaceParsed: null, err: true, }
        },

        //----------------------------------------
        // name length
        {
            note: 'x: empty name',
            input: '//.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW', 
            output: { workspaceParsed: null, err: true, }
        }, {
            note: 'ok: name 1 char long',
            input: '//x.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW', 
            output: {
                workspaceParsed: {
                    address: '//x.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
                    name: 'x',
                    pubkey: '2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
                },
                err: null,
            }
        }, {
            note: 'ok: name 15 chars long',
            input: '//aaaaabbbbbccccc.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW', 
            output: {
                workspaceParsed: {
                    address: '//aaaaabbbbbccccc.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
                    name: 'aaaaabbbbbccccc',
                    pubkey: '2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
                },
                err: null,
            }
        }, {
            note: 'x: name 16 chars long',
            input: '//aaaaabbbbbcccccd.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW', 
            output: { workspaceParsed: null, err: true, }
        },
    ];
    for (let v of vectors) {
        let actualOutput = parseWorkspaceAddress(v.input);
        if (actualOutput.err) {
            t.same(!!v.output.err, !!actualOutput.err, v.note || 'vector should have error but does not');
        } else {
            log(actualOutput.err);
            t.same(v.output, actualOutput, v.note || 'vector should succeed');
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
            input: '@suzy.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
            output: {
                authorParsed: {
                    address: '@suzy.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
                    shortname: 'suzy',
                    pubkey: '2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
                },
                err: null,
            }
        },

        //----------------------------------------
        // overall shape
        {
            note: 'x: empty string',
            input: '', 
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: no leading @',
            input: 'suzy.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
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
            input: '//SUZY.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: emoji in name',
            input: '//suz' + sparkleEmoji + '.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: snowman in name',
            input: '//suz' + snowmanJsString + '.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: newline in name',
            input: '//su\nz.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: newline in key',
            input: '//suzy.2F2jmsq\nfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: ! in key',
            input: '//suzy.2!2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: space in name',
            input: '//su z.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: dash in name',
            input: '//su-z.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: number in name',
            input: '//su00.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
            output: { authorParsed: null, err: true, }
        },

        //----------------------------------------
        // periods
        {
            note: 'x: too many periods',
            input: '//suzy.foo.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: no periods',
            input: '//suzy2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW',
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: no name',
            input: '//2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW', 
            output: { authorParsed: null, err: true, }
        },

        //----------------------------------------
        // name length
        {
            note: 'x: empty name',
            input: '//.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW', 
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: name 1 char long',
            input: '//a.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW', 
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: name 3 chars long',
            input: '//abc.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW', 
            output: { authorParsed: null, err: true, }
        }, {
            note: 'x: name 5 chars long',
            input: '//abcde.2F2jmsqfTCK9HDRiFbXGa5JzRxYaej5Q2ebHs7wrWdkW', 
            output: { authorParsed: null, err: true, }
        }
    ];
    for (let v of vectors) {
        let actualOutput = parseAuthorAddress(v.input);
        if (actualOutput.err) {
            t.same(!!v.output.err, !!actualOutput.err, v.note || 'vector should have error but does not');
        } else {
            log(actualOutput.err);
            t.same(v.output, actualOutput, v.note || 'vector should succeed');
        }
    }
    t.end();
});


