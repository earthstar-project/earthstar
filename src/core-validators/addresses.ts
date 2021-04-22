import {
    AuthorAddress,
    AuthorShortname,
    Base32String,
    ParsedAddress,
    WorkspaceAddress,
    WorkspaceName,
} from '../util/doc-types';
import {
    ValidationError,
    notErr,
} from '../util/errors';

import {
    authorKeyChars,
    authorNameChars,
    isDigit,
    onlyHasChars,
    workspaceKeyChars,
    workspaceNameChars,
} from './characters';

//================================================================================

export let assembleAuthorAddress = (name: AuthorShortname, encodedPubkey: Base32String): AuthorAddress =>
    // This doesn't check if it's valid; to do that, parse it and see if parsing has an error.
    `@${name}.${encodedPubkey}`;

export let assembleWorkspaceAddress = (name: WorkspaceName, encodedPubkey: Base32String): WorkspaceAddress =>
    // This doesn't check if it's valid; to do that, parse it and see if parsing has an error.
    `+${name}.${encodedPubkey}`;


export let checkAuthorIsValid = (addr: AuthorAddress): true | ValidationError => {
    let parsed = parseAuthorAddress(addr);
    if (notErr(parsed)) { return true; }
    return parsed;
}

export let checkWorkspaceIsValid = (addr: WorkspaceAddress): true | ValidationError => {
    let parsed = parseWorkspaceAddress(addr);
    if (notErr(parsed)) { return true; }
    return parsed;
}


/** Parse an author address into its parts. */
export let parseAuthorAddress = (address: AuthorAddress): ParsedAddress | ValidationError => {
    return parseAddress(address, {
        sigil: '@',
        separator: '.',
        minNameLength: 4,
        maxNameLength: 4,
        minPubkeyLength: 53,
        maxPubkeyLength: 53,
        allowedNameCharacters: authorNameChars,
        allowedPubkeyCharacters: authorKeyChars,
        pubkeyMustStartWithB: true,
    });
}

/** Parse a workspace address into its parts. */
export let parseWorkspaceAddress = (address: WorkspaceAddress): ParsedAddress | ValidationError => {
    return parseAddress(address, {
        sigil: '+',
        separator: '.',
        minNameLength: 1,
        maxNameLength: 15,
        minPubkeyLength: 1,
        maxPubkeyLength: 53,
        allowedNameCharacters: workspaceNameChars,
        allowedPubkeyCharacters: workspaceKeyChars,
        pubkeyMustStartWithB: false,
    });
}

interface ParseAddressOpts {
    sigil: string,  // '+' or '@'
    separator: string,  // '.'
    minNameLength: number,
    maxNameLength: number,
    minPubkeyLength: number,
    maxPubkeyLength: number,
    allowedNameCharacters: string,
    allowedPubkeyCharacters: string,
    pubkeyMustStartWithB: boolean,
}
export let parseAddress = (address: string, opts: ParseAddressOpts): ParsedAddress | ValidationError => {
    let {
        sigil,
        separator,
        minNameLength,
        maxNameLength,
        minPubkeyLength,
        maxPubkeyLength,
        allowedNameCharacters,
        allowedPubkeyCharacters,
        pubkeyMustStartWithB,
    } = opts;
    if (typeof address !== 'string') { return new ValidationError('address must be a string'); }
    if (address.length < 4) { return new ValidationError('address is too short'); }
    if (address[0] !== sigil) { return new ValidationError(`address must start with a sigil: "${sigil}"`); }
    if (address.indexOf(separator) === -1) { return new ValidationError(`address must contain a separator character: "${separator}"`); }
    let parts = address.slice(1).split(separator);
    if (parts.length !== 2) { return new ValidationError(`address must have exactly 2 parts separated by a "${separator}" separator`); }
    let [name, pubkey] = parts;
    if (name.length < minNameLength || name.length > maxNameLength) { return new ValidationError(`name must be between ${minNameLength} and ${maxNameLength} characters long, but is ${name.length}`); }
    if (pubkey.length < minPubkeyLength || pubkey.length > maxPubkeyLength) { return new ValidationError(`pubkey must be between ${minPubkeyLength} and ${maxPubkeyLength} characters long, but is ${pubkey.length}`); }
    if (!onlyHasChars(name, allowedNameCharacters)) { return new ValidationError(`name "${name}" must only have allowed characters`); }
    if (!onlyHasChars(pubkey, allowedPubkeyCharacters)) { return new ValidationError(`pubkey "${pubkey}" must only have allowed characters`); }
    if (isDigit(name[0])) { return new ValidationError(`name "${name}" must not start with a digit`); }
    if (isDigit(pubkey[0])) { return new ValidationError(`pubkey "${pubkey}" must not start with a digit`); }
    if (pubkeyMustStartWithB && pubkey[0] !== 'b') { return new ValidationError(`pubkey "${pubkey}" must start with 'b'`); }

    return {
        address,
        name,
        pubkey,
    };
}
