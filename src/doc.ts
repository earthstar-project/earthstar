import {
    Cmp,
} from './types/utilTypes';
import {
    Doc,
} from './types/docTypes';

import {
    arrayCompare,
} from './util/utils';

import { makeDebug } from './util/log';
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
