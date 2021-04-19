import {
    AuthorAddress,
    AuthorParsed,
    AuthorShortname,
    Base32String,
    WorkspaceAddress,
    WorkspaceName,
    WorkspaceParsed,
} from '../types/docTypes';
import { isErr, ValidationError } from '../util/errors';

export let assembleWorkspaceAddress = (name: WorkspaceName, encodedPubkey: Base32String): WorkspaceAddress =>
    // This doesn't check if it's valid; to do that, parse it and see if parsing has an error.
    `+${name}.${encodedPubkey}`;

export let assembleAuthorAddress = (shortname: AuthorShortname, encodedPubkey: Base32String): AuthorAddress =>
    // This doesn't check if it's valid; to do that, parse it and see if parsing has an error.
    `@${shortname}.${encodedPubkey}`;

export let checkAuthorIsValid = (authorAddress: AuthorAddress): true | ValidationError => {
    return true;  // TODO: not implemented yet
}

export let checkWorkspaceIsValid = (workspaceAddress: WorkspaceAddress): true | ValidationError => {
    return true;  // TODO: not implemented yet
}

/** Parse an author address into its parts. */
export let parseAuthorAddress = (addr: AuthorAddress): AuthorParsed | ValidationError => {
    let isValid = checkAuthorIsValid(addr);
    if (isErr(isValid)) { return isValid; }
    return new ValidationError('not implemented yet');
}

/** Parse a workspace address into its parts. */
export let parseWorkspaceAddress = (addr: WorkspaceAddress): WorkspaceParsed | ValidationError => {
    let isValid = checkWorkspaceIsValid(addr);
    if (isErr(isValid)) { return isValid; }
    return new ValidationError('not implemented yet');
}
