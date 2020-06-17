import {
    AuthorAddress,
    AuthorKeypair,
    DocToSet,
    Document,
    IStorage,
    IValidator,
    QueryOpts,
    SyncOpts,
    SyncResults,
    WorkspaceAddress,
} from '../util/types';
import { Emitter } from '../util/emitter';
import { parseWorkspaceAddress } from '../util/addresses';
import { workspaceNameChars } from '../util/characters';

let log = console.log;
//let logWarning = console.log;
//let log = (...args : any[]) => void {};  // turn off logging for now
let logWarning = (...args : any[]) => void {};  // turn off logging for now

export let _historySortFn = (a: Document, b: Document): number => {
    // When used within one key, puts the winning revision first.
    // path ASC (abcd), then timestamp DESC (newest first), then signature DESC (to break timestamp ties)
    if (a.path > b.path) { return 1; }
    if (a.path < b.path) { return -1; }
    if (a.timestamp < b.timestamp) { return 1; }
    if (a.timestamp > b.timestamp) { return -1; }
    if (a.signature < b.signature) { return 1; }
    if (a.signature > b.signature) { return -1; }
    return 0;
};

export class StorageMemory implements IStorage {
    /*
    This uses an in-memory data structure:
    _docs:
    {
        keyA: {
            @author1: {...DOC...},
            @author2: {...DOC...},
        }
        keyB: {
            @author1: {...DOC...},
        }
    }
    _docs[key] is never an empty object, it's always missing or contains docs.

    Each key can have one doc per author.
    Keys with write permissions will only have one author, thus only one doc.
    Public keys can have multiple authors, but one is considered the winner
      (with the highest timestamp).
    */
    _docs : {[key:string] : {[author:string] : Document}} = {};
    workspace : WorkspaceAddress;
    validatorMap : {[format: string] : IValidator};
    onChange : Emitter<undefined>;
    constructor(validators : IValidator[], workspace : WorkspaceAddress) {
        let {workspaceParsed, err} = parseWorkspaceAddress(workspace);
        if (err || !workspaceParsed) { throw 'invalid workspace address: ' + err; }

        this.workspace = workspace;

        this.onChange = new Emitter<undefined>();

        if (validators.length === 0) {
            throw "must provide at least one validator";
        }
        this.validatorMap = {};
        for (let validator of validators) {
            this.validatorMap[validator.format] = validator;
        }
    }

    paths(query? : QueryOpts) : string[] {
        query = query || {};

        // if asking for a single key, check if it exists and return it by itself
        if (query.path !== undefined) {
            if (this._docs[query.path] !== undefined) {
                return [query.path];
            } else {
                return [];
            }
        }
        // don't apply the limit in documents(), do it here
        // after removing duplicates
        let docs = this.documents({...query, limit: undefined});
        // get unique paths up to limit
        let paths : {[p:string] : boolean} = {};
        let ii = 0;
        for (let doc of docs) {
            paths[doc.path] = true;
            ii += 1;
            if (query.limit !== undefined && ii >= query.limit) { break; }
        }
        return Object.keys(paths);
    }
    documents(query? : QueryOpts) : Document[] {
        // return docs that match the query, sorted by path and timestamp
        query = query || {};
        let docs : Document[] = [];
        for (let key of Object.keys(this._docs)) {
            // ignore unwanted keys
            if (query.lowPath !== undefined && key < query.lowPath) { continue; }
            if (query.highPath !== undefined && key >= query.highPath) { continue; }
            if (query.pathPrefix !== undefined && !key.startsWith(query.pathPrefix)) { continue; }
            // get all history docs for this key
            let authorToDoc = this._docs[key];
            let keyDocs = Object.values(authorToDoc);
            // is the desired participatingAuthor anywhere in this set of docs?
            // if not, discard it
            if (query.participatingAuthor !== undefined) {
                if (authorToDoc[query.participatingAuthor] === undefined) {
                    continue;
                }
            }
            // sort newest first within this key
            keyDocs.sort(_historySortFn);
            // discard history?
            if (!query.includeHistory) {
                keyDocs = keyDocs.slice(0, 1)
            }
            docs = docs.concat(keyDocs);
        }
        // apply author filters
        if (query.versionsByAuthor !== undefined) {
            docs = docs.filter(doc => doc.author === query?.versionsByAuthor);
        }
        // sort
        docs.sort(_historySortFn);
        // limit
        if (query.limit) {
            docs = docs.slice(0, query.limit);
        }
        return docs;
    }
    values(query? : QueryOpts) : string[] {
        // same as docs, but we just return the values.
        return this.documents(query).map(doc => doc.value);
    }

    authors() : AuthorAddress[] {
        let authorSet : Set<AuthorAddress> = new Set();
        for (let doc of this.documents({ includeHistory: true })) {
            authorSet.add(doc.author);
        }
        let authors = [...authorSet];
        authors.sort();
        return authors;
    }

    getDocument(key : string) : Document | undefined {
        // look up the winning value for a single key.
        // return undefined if not found.
        // to get history docs for a key, do documents({key: 'foo', includeHistory: true})
        if (this._docs[key] === undefined) { return undefined; }
        let keyHistoryDocs = Object.values(this._docs[key]);
        keyHistoryDocs.sort(_historySortFn);
        return keyHistoryDocs[0];
    }
    getValue(key : string) : string | undefined {
        // same as getDocument, but just returns the value, not the whole doc object.
        return this.getDocument(key)?.value;
    }

    ingestDocument(doc : Document, futureCutoff? : number) : boolean {
        // Given a doc from elsewhere, validate, decide if we want it, and possibly store it.
        // Return true if we kept it, false if we rejected it.

        // It can be rejected if it's not the latest one from the same author,
        // or if the doc is invalid (signature, etc).

        // Within a single key we keep the one latest doc from each author.
        // So this overwrites older docs from the same author - they are forgotten.
        // If it's from a new author for this key, we keep it no matter the timestamp.
        // The winning doc is chosen at get time, not write time.

        // futureCutoff is a timestamp in microseconds.
        // Messages from after that are ignored.
        // Defaults to now + 10 minutes.
        // This prevents malicious peers from sending very high timestamps.

        let validator = this.validatorMap[doc.format];
        if (validator === undefined) {
            logWarning(`ingestDocument: unrecognized format ${doc.format}`);
            return false;
        }

        if (!validator.documentIsValid(doc, futureCutoff)) {
            logWarning(`ingestDocument: doc is not valid`);
            return false;
        }

        // Only accept docs from the same workspace.
        if (doc.workspace !== this.workspace) {
            logWarning(`ingestDocument: doc from different workspace`);
            return false;
        }

        let existingDocsByKey = this._docs[doc.path] || {};
        let existingFromSameAuthor = existingDocsByKey[doc.author];

        // Compare timestamps.
        // Compare signature to break timestamp ties.
        if (existingFromSameAuthor !== undefined
            && [doc.timestamp, doc.signature]
            <= [existingFromSameAuthor.timestamp, existingFromSameAuthor.signature]
            ) {
            // incoming doc is older or identical.  ignore it.
            logWarning(`ingestDoc: doc older or identical`);
            return false;
        }

        existingDocsByKey[doc.author] = doc;
        this._docs[doc.path] = existingDocsByKey;
        this.onChange.send(undefined);
        return true;
    }

    set(keypair : AuthorKeypair, docToSet : DocToSet) : boolean {
        // Store a value.
        // Timestamp is optional and should normally be omitted or set to 0,
        // in which case it will be set to now().
        // (New writes should always have a timestamp of now() except during
        // unit testing or if you're importing old data.)

        let validator = this.validatorMap[docToSet.format];
        if (validator === undefined) {
            logWarning(`set: unrecognized format ${docToSet.format}`);
            return false;
        }

        docToSet.timestamp = docToSet.timestamp || 0;
        let doc : Document = {
            format: docToSet.format,
            workspace: this.workspace,
            path: docToSet.path,
            value: docToSet.value,
            author: keypair.address,
            timestamp: docToSet.timestamp > 0 ? docToSet.timestamp : Date.now()*1000,
            signature: '',
        }

        // If there's an existing doc from anyone,
        // make sure our timestamp is greater
        // even if this puts us slightly into the future.
        // (We know about the existing doc so let's assume we want to supercede it.)
        let existingDocTimestamp = this.getDocument(doc.path)?.timestamp || 0;
        doc.timestamp = Math.max(doc.timestamp, existingDocTimestamp+1);

        let signedDoc = validator.signDocument(keypair, doc);
        return this.ingestDocument(signedDoc, doc.timestamp);
    }

    _syncFrom(otherStore : IStorage, existing : boolean, live : boolean) : number {
        // Pull all docs from the other Store and ingest them one by one.

        let numSuccess = 0;
        if (live) {
            // TODO
            throw "live sync not implemented yet";
        }
        if (existing) {
            for (let doc of otherStore.documents({includeHistory: true})) {
                let success = this.ingestDocument(doc);
                if (success) { numSuccess += 1; }
            }
        }
        return numSuccess;
    }

    sync(otherStore : IStorage, opts? : SyncOpts) : SyncResults {
        // Sync with another Store.
        //   opts.direction: 'push', 'pull', or 'both'
        //   opts.existing: Sync existing values.  Default true.
        //   opts.live (not implemented yet): Continue streaming new changes forever
        // Return the number of docs pushed and pulled.
        // This uses a simple and inefficient algorithm.  Fancier algorithm TBD.

        // don't sync with yourself
        if (otherStore === this) { return { numPushed: 0, numPulled: 0 }; }

        // don't sync across workspaces
        if (this.workspace !== otherStore.workspace) { return { numPushed: 0, numPulled: 0}; }

        // set default options
        let direction = opts?.direction || 'both';
        let existing = (opts?.existing !== undefined) ? opts?.existing : true;
        let live = (opts?.live !== undefined) ? opts?.live : false;

        let numPushed = 0;
        let numPulled = 0;
        if (direction === 'pull' || direction === 'both') {
            numPulled = this._syncFrom(otherStore, existing, live);
        }
        if (direction === 'push' || direction === 'both') {
            numPushed = otherStore._syncFrom(this, existing, live);
        }
        return { numPushed, numPulled };
    }
}
