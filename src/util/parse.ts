import {
    Author,
    Workspace,
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

export let parseWorkspaceAddress = (addr : string) : {workspace: Workspace | null, err : string | null} => {
    // example: //solarpunk.6efJ8v8rtwoBxfN5MKeTF2Qqyf6zBmwmv8oAbendBZHP
    if (!isOnlyPrintableAscii(addr)) {
        return { workspace: null, err: 'workspace address has nonprintable characters' };
    }
    if (!addr.startsWith('//')) {
        return { workspace: null, err: 'workspace address does not start with "@"' };
    }
    let parts = addr.slice(2).split('.');
    if (parts.length !== 2) {
        return { workspace: null, err: 'workspace address does not have two parts separated by "."' };
    }
    let [name, pubkey] = parts;
    if (name.length < 1 || name.length > 15) {
        return { workspace: null, err: `workspace shortname ${JSON.stringify(name)} is not between 1 and 15 chars long` };
    }
    if (pubkey.length < 1 || pubkey.length > 44) {
        return { workspace: null, err: `workspace pubkey ${JSON.stringify(name)} is not between 1 and 44 chars long` };
    }
    if (!onlyHasChars(name, workspaceNameChars)) {
        return { workspace: null, err: `workspace name ${JSON.stringify(name)} uses disallowed chars` };
    }
    if (!onlyHasChars(pubkey, b58chars)) {
        return { workspace: null, err: `workspace pubkey ${JSON.stringify(name)} uses disallowed chars` };
    }
    return {
        workspace: {
            address: addr,
            name: name,
            pubkey: pubkey,
        },
        err: null,
    }
}

export let parseAuthorAddress = (addr : string) : {author: Author | null, err : string | null} => {
    // example: @suzy.6efJ8v8rtwoBxfN5MKeTF2Qqyf6zBmwmv8oAbendBZHP
    if (!isOnlyPrintableAscii(addr)) {
        return { author: null, err: 'author address has nonprintable characters' };
    }
    if (!addr.startsWith('@')) {
        return { author: null, err: 'author address does not start with "@"' };
    }
    let parts = addr.slice(1).split('.');
    if (parts.length !== 2) {
        return { author: null, err: 'author address does not have two parts separated by "."' };
    }
    let [shortname, pubkey] = parts;
    if (shortname.length !== 4) {
        return { author: null, err: `author shortname ${JSON.stringify(shortname)} is not 4 chars long` };
    }
    if (pubkey.length < 40 || pubkey.length > 44) {
        return { author: null, err: `author pubkey ${JSON.stringify(shortname)} is not between 40 and 44 chars long` };
    }
    if (!onlyHasChars(shortname, authorShortnameChars)) {
        return { author: null, err: `author shortname ${JSON.stringify(shortname)} uses disallowed chars` };
    }
    if (!onlyHasChars(pubkey, b58chars)) {
        return { author: null, err: `author pubkey ${JSON.stringify(shortname)} uses disallowed chars` };
    }
    return {
        author: {
            address: addr,
            shortname: shortname,
            pubkey: pubkey,
        },
        err: null,
    }
}
