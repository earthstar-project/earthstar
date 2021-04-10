import {
    Cmp,
} from './types/utilTypes';
import {
    AuthorKeypair,
    Doc,
} from './types/docTypes';

import {
    arrayCompare,
    fakeUuid,
} from './utils';

import { makeDebug } from './log';
import chalk from 'chalk';
let debug = makeDebug(chalk.white('                                 [doc]'));

//================================================================================

export let combinePathAndAuthor = (doc: Doc) => {
    // This is used as a key into the path&author index
    // It must use a separator character that's not valid in either paths or author addresses
    return `${doc.path}|${doc.author}`;
}

export let docComparePathThenNewestFirst = (a: Doc, b: Doc): Cmp => {
    // Sorts docs by path ASC, then breaks ties by timestamp DESC (newest first)
    if (a.signature === b.signature) { return Cmp.EQ; }
    return arrayCompare(
        [a.path, -a.timestamp],
        [b.path, -b.timestamp],
    );
}
export let docCompareForOverwrite = (newDoc: Doc, oldDoc: Doc): Cmp => {
    // A doc can overwrite another doc if the timestamp is higher, or
    // if the timestamp is tied, if the signature is higher.
    return arrayCompare(
        [newDoc.timestamp, newDoc.signature],
        [oldDoc.timestamp, oldDoc.signature],
    );
}

export let signDoc = (authorKeypair: AuthorKeypair, doc: Doc): void => {
    // mutate the doc to set the signature.
    debug('signDoc');
    doc.signature = 'fake-sig:' + fakeUuid();  // TODO
}

export let docIsValid = (doc: Doc): boolean => {
    debug('docIsValid');
    return true;  // TODO: check document validity
}
