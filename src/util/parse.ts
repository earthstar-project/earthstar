import {
    AuthorParsed,
    WorkspaceParsed,
} from './types';

export let onlyHasChars = (str : string, allowedChars : string) : boolean => {
    for (let s of str) {
        if (allowedChars.indexOf(s) === -1) { return false; }
    }
    return true;
}
export let isOnlyPrintableAscii = (s : string) : boolean => {
    let buf = Buffer.from(s, 'utf8');
    for (let char of buf) {
        // char must be between ' ' (space) and '~' inclusive
        if (char < 32 || char > 126) { return false; }
    }
    return true;
}

const alphaLower = 'abcdefghijklmnopqrstuvwxyz';
const alphaUpper = alphaLower.toUpperCase();
const digits = '0123456789';
const authorShortnameChars = alphaLower;
const workspaceNameChars = alphaLower;
const b58chars = alphaLower + alphaUpper + digits;  // todo: make this match b58 charset
const pathChars = alphaLower + alphaUpper + digits + "/'()-._~!*$&+,:=?@%";

export let isValidPath = (path : string) : boolean =>
    path.startsWith('/') && onlyHasChars(path, pathChars);

export let parseWorkspaceAddress = (addr : string) : {workspaceParsed: WorkspaceParsed | null, err : string | null} => {
    // example: //solarpunk.6efJ8v8rtwoBxfN5MKeTF2Qqyf6zBmwmv8oAbendBZHP
    if (!isOnlyPrintableAscii(addr)) {
        return { workspaceParsed: null, err: 'workspace address has nonprintable characters' };
    }
    if (!addr.startsWith('//')) {
        return { workspaceParsed: null, err: 'workspace address does not start with "@"' };
    }
    let parts = addr.slice(2).split('.');
    if (parts.length !== 2) {
        return { workspaceParsed: null, err: 'workspace address does not have two parts separated by "."' };
    }
    let [name, pubkey] = parts;
    if (name.length < 1 || name.length > 15) {
        return { workspaceParsed: null, err: `workspace shortname ${JSON.stringify(name)} is not between 1 and 15 chars long` };
    }
    if (pubkey.length < 1 || pubkey.length > 44) {
        return { workspaceParsed: null, err: `workspace pubkey ${JSON.stringify(name)} is not between 1 and 44 chars long` };
    }
    if (!onlyHasChars(name, workspaceNameChars)) {
        return { workspaceParsed: null, err: `workspace name ${JSON.stringify(name)} uses disallowed chars` };
    }
    if (!onlyHasChars(pubkey, b58chars)) {
        return { workspaceParsed: null, err: `workspace pubkey ${JSON.stringify(name)} uses disallowed chars` };
    }
    return {
        workspaceParsed: {
            address: addr,
            name: name,
            pubkey: pubkey,
        },
        err: null,
    }
}

export let parseAuthorAddress = (addr : string) : {authorParsed: AuthorParsed | null, err : string | null} => {
    // example: @suzy.6efJ8v8rtwoBxfN5MKeTF2Qqyf6zBmwmv8oAbendBZHP
    if (!isOnlyPrintableAscii(addr)) {
        return { authorParsed: null, err: 'author address has nonprintable characters' };
    }
    if (!addr.startsWith('@')) {
        return { authorParsed: null, err: 'author address does not start with "@"' };
    }
    let parts = addr.slice(1).split('.');
    if (parts.length !== 2) {
        return { authorParsed: null, err: 'author address does not have two parts separated by "."' };
    }
    let [shortname, pubkey] = parts;
    if (shortname.length !== 4) {
        return { authorParsed: null, err: `author shortname ${JSON.stringify(shortname)} is not 4 chars long` };
    }
    if (pubkey.length < 40 || pubkey.length > 44) {
        return { authorParsed: null, err: `author pubkey ${JSON.stringify(shortname)} is not between 40 and 44 chars long` };
    }
    if (!onlyHasChars(shortname, authorShortnameChars)) {
        return { authorParsed: null, err: `author shortname ${JSON.stringify(shortname)} uses disallowed chars` };
    }
    if (!onlyHasChars(pubkey, b58chars)) {
        return { authorParsed: null, err: `author pubkey ${JSON.stringify(shortname)} uses disallowed chars` };
    }
    return {
        authorParsed: {
            address: addr,
            shortname: shortname,
            pubkey: pubkey,
        },
        err: null,
    }
}
