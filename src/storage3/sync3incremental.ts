import {
    AuthorAddress,
    Document,
    EarthstarError,
    NetworkError,
    Path,
    WriteResult,
    isErr,
} from '../util/types';
import {
    IStorage3,
} from './types3';
import {
    Query3,
} from './query3';
import { Storage3Memory } from './storage3Memory';
import { ValidatorEs4 } from '../validator/es4';
import { logDebug } from '../util/log';

//================================================================================

export type Fingerprint = [Path, AuthorAddress, number, string];  // path, author, timestamp, signaturePrefix

/**
 * Iterate through a query.
 * 
 * If the query has a limit or limitBytes, does multiple queries to
 * advance all the way through the documents.  The caller decides
 * what the limit should be.
 */
export async function* localQueryIterator(storage: IStorage3, query: Query3): AsyncGenerator<Document, void, unknown> {
    while (true) {
        let docs = storage.documents(query);
        logDebug(`query got ${docs.length} docs`);
        if (docs.length === 0) {
            // no results.  we're done.
            logDebug(`    exhausted`);
            return;
        }
        for (let doc of docs) {
            yield doc;
        }
        if (query.limit === undefined && query.limitBytes === undefined) {
            // we got everything at once, so we're done
            logDebug(`    done in one shot`);
            return;
        }
        let lastDoc = docs[docs.length-1];
        logDebug(`    continuing...`);
        query = {
            ...query,
            continueAfter: { path: lastDoc.path, author: lastDoc.author},
        };
    }
}

/** Map a doc async-iterator to fingerprints. */
export async function* docToFingerprintIterator(docs: AsyncGenerator<Document, void, unknown>): AsyncGenerator<Fingerprint, void, unknown> {
    for await (let doc of docs) {
        yield [doc.path, doc.author, doc.timestamp, doc.signature];
    }
}

/**
 * Given two fingerprint async-iterators,
 * return a series of pairs [Fingerprint | undefined, Fingerprint | undefined].
 * 
 * For example, using integers instead of fingerprints for this example:
 *     * [1, undefined] -- only fIter1 had item #1
 *     * [undefined, 2] -- only fIter2 had item #2
 *     * [3, 3] -- both had item #3
 *     * [4, undefined] -- only fIter1 had item #4
 * 
 * Fingerprints are considered equal if the path and author match.
 * 
 * The sequence ends when both input iterators are exhausted.
 * 
 * Assumes the iterators are sorted in ascending path-then-author order.
 */
export async function* fingerprintIteratorZipper(fIter1: AsyncGenerator<Fingerprint, void, unknown>, fIter2: AsyncGenerator<Fingerprint, void, unknown>):
    AsyncGenerator<[Fingerprint | undefined, Fingerprint | undefined], void, unknown>
    {
    let f1: Fingerprint | undefined = (await fIter1.next()).value as (Fingerprint | undefined);
    let f2: Fingerprint | undefined = (await fIter2.next()).value as (Fingerprint | undefined);
    while (true) {
        if (f1 === undefined) {
            if (f2 === undefined) {
                // both are spent
                return;
            } else {
                // f1 is spent, f2 is still going
                yield [undefined, f2];
                f2 = (await fIter2.next()).value as (Fingerprint | undefined);
            }
        } else {
            if (f2 === undefined) {
                // f1 is still going, f2 is spent
                yield [f1, undefined];
                f1 = (await fIter1.next()).value as (Fingerprint | undefined);
            } else {
                // both are still going.  compare them.
                let [f1path, f1author, f1timestamp, f1sig] = f1;
                let [f2path, f2author, f2timestamp, f2sig] = f2;
                let eq = f1path === f2path && f1author === f2author;
                let f1SortsFirst = (f1path < f2path) || (f1path === f2path && f1author > f2author);
                if (eq) {
                    // they match; yield both
                    yield [f1, f2];
                    f1 = (await fIter1.next()).value as (Fingerprint | undefined);
                    f2 = (await fIter2.next()).value as (Fingerprint | undefined);
                } else if (f1SortsFirst) {
                    // f1 sorts first, revealing a gap in f2
                    yield [f1, undefined];
                    f1 = (await fIter1.next()).value as (Fingerprint | undefined);
                } else {
                    // f2 sorts first, revealing a gap in f1
                    yield [undefined, f2];
                    f2 = (await fIter2.next()).value as (Fingerprint | undefined);
                }
            }
        }
    }
}


let storage = new Storage3Memory([ValidatorEs4], '+foo.bar');
let f1 = docToFingerprintIterator(localQueryIterator(storage, { history: 'all', limit: 10 }));
let f2 = docToFingerprintIterator(localQueryIterator(storage, { history: 'all', limit: 10 }));
let pairs = fingerprintIteratorZipper(f1, f2);



