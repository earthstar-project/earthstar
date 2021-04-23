import {
    Cmp,
} from './util-types';
import {
    AuthorKeypair,
    Doc,
    DocToSet,
    LocalIndex,
    Path,
    WorkspaceAddress,
} from '../util/doc-types';
import {
    HistoryMode,
    Query,
} from './query-types';
import {
    IFollower,
    IngestResult,
    IStorageDriverAsync,
    IStorageAsync,
} from './storage-types';
import {
    IFormatValidator,
} from '../format-validators/format-validator-types';

import {
    isErr,
} from '../util/errors';
import {
    microsecondNow,
} from '../util/misc';
import {
    arrayCompare,
} from './compare';

//--------------------------------------------------

import { makeDebug } from '../util/log';
import chalk from 'chalk';
let debug = makeDebug(chalk.yellow('      [storage]'));

//================================================================================

export let docCompareForOverwrite = (newDoc: Doc, oldDoc: Doc): Cmp => {
    // A doc can overwrite another doc if the timestamp is higher, or
    // if the timestamp is tied, if the signature is higher.
    return arrayCompare(
        [newDoc.timestamp, newDoc.signature],
        [oldDoc.timestamp, oldDoc.signature],
    );
}

export class StorageAsync implements IStorageAsync {
    workspace: WorkspaceAddress;
    formatValidator: IFormatValidator;
    storageDriver: IStorageDriverAsync;

    // Followers
    _followers: Set<IFollower> = new Set();

    constructor(workspace: WorkspaceAddress, validator: IFormatValidator, driver: IStorageDriverAsync) {
        debug('constructor, given a storageDriver');
        this.workspace = workspace;
        this.formatValidator = validator;
        this.storageDriver = driver;
    }

    async getDocsSinceLocalIndex(historyMode: HistoryMode, startAt: LocalIndex, limit?: number): Promise<Doc[]> {
        debug(`getDocsSinceLocalIndex(${historyMode}, ${startAt}, ${limit})`);
        let query: Query = {
            historyMode: historyMode,
            orderBy: 'localIndex ASC',
            startAt: {
                localIndex: startAt,
            },
            limit,
        };
        return await this.storageDriver.queryDocs(query);
    }

    //--------------------------------------------------
    // GET
    async getAllDocs(): Promise<Doc[]> {
        debug(`getAllDocs()`);
        return await this.storageDriver.queryDocs({
            historyMode: 'all',
            orderBy: 'path DESC',
        });
    }
    async getLatestDocs(): Promise<Doc[]> {
        debug(`getLatestDocs()`);
        return await this.storageDriver.queryDocs({
            historyMode: 'latest',
            orderBy: 'path DESC',
        });
    }
    async getAllDocsAtPath(path: Path): Promise<Doc[]> {
        debug(`getAllDocsAtPath("${path}")`);
        return await this.storageDriver.queryDocs({
            historyMode: 'all',
            orderBy: 'path DESC',
            filter: { path: path, }
        });
    }
    async getLatestDocAtPath(path: Path): Promise<Doc | undefined> {
        debug(`getLatestDocsAtPath("${path}")`);
        let docs = await this.storageDriver.queryDocs({
            historyMode: 'all',
            orderBy: 'path DESC',
            filter: { path: path, }
        });
        if (docs.length === 0) { return undefined; }
        return docs[0];
    }

    async queryDocs(query: Query = {}): Promise<Doc[]> {
        debug(`queryDocs`, query);
        return await this.storageDriver.queryDocs(query);
    }

    //queryPaths(query?: Query): Path[];
    //queryAuthors(query?: Query): AuthorAddress[];

    //--------------------------------------------------
    // SET

    async set(keypair: AuthorKeypair, docToSet: DocToSet): Promise<IngestResult> {
        debug(`set`, docToSet);
        let protectedCode = async (): Promise<IngestResult> => {
            debug('  +');
            debug('  | deciding timestamp: getting latest doc at the same path (from any author)');
            // bump timestamp if needed to win over existing latest doc at same path
            let existingDocSamePath = await this.getLatestDocAtPath(docToSet.path);
            let timestamp: number;
            if (existingDocSamePath === undefined) {
                debug('  |     no existing doc, setting timestamp to now()');
                timestamp = microsecondNow();
            } else {
                debug('  |     existing doc found, bumping timestamp to win if needed');
                timestamp = Math.max(microsecondNow(), existingDocSamePath.timestamp + 1);
            }

            let doc: Doc = {
                format: 'es.4',
                author: keypair.address,
                content: docToSet.content,
                // to get access to sha256, we have to reach into the validator and get its Crypto instance
                contentHash: this.formatValidator.crypto.sha256base32(docToSet.content),
                deleteAfter: null,
                path: docToSet.path,
                timestamp,
                workspace: docToSet.workspace,
                signature: '?',  // signature will be added in just a moment
                // _localIndex will be added during upsert.  it's not needed for the signature.
            }

            debug('  | signing doc');
            let signedDoc = this.formatValidator.signDocument(keypair, doc);
            if (isErr(signedDoc)) {
                return IngestResult.Invalid;
            }

            debug('  | ingesting...');
            let result = await this.ingest(signedDoc, false);  // false meanse don't get lock again
            debug('  | ...done ingesting', result);
            debug('  +');
            return result;
        }

        debug('    running protected region...');
        let result = await this.storageDriver.lock.run(protectedCode);
        debug('    ...done running protected region', result);

        return result;
    }

    async ingest(doc: Doc, _getLock: boolean = true): Promise<IngestResult> {
        debug(`ingest`, doc);

        // check basic validity (signature, etc)
        debug('    checking doc validity');
        let docIsValid = this.formatValidator.checkDocumentIsValid(doc);
        if (isErr(docIsValid)) { return IngestResult.Invalid; }

        // remove the _localIndex (from the other peer) and keep it around
        let remoteIndex = doc._localIndex;
        debug('    deleting metadata from doc; remoteIndex = ', remoteIndex);
        delete doc._localIndex;

        let protectedCode = async (): Promise<IngestResult> => {
            // get other docs at the same path
            debug('  > getting other docs at the same path');
            let existingDocsSamePath = await this.storageDriver.queryDocs({
                historyMode: 'all',
                orderBy: 'path DESC', // newest first
                filter: { path: doc.path }
            });

            // check if this is obsolete or redudant from the same other
            debug('  > checking if obsolete from same author');
            let existingDocSameAuthor = existingDocsSamePath.filter(d =>
                d.author === doc.author)[0];
            if (existingDocSameAuthor !== undefined) {
                let docComp = docCompareForOverwrite(doc, existingDocSameAuthor);
                if (docComp === Cmp.LT) { return IngestResult.ObsoleteFromSameAuthor; }
                if (docComp === Cmp.EQ) { return IngestResult.AlreadyHadIt; }
            }
        
            // check if latest
            debug('  > checking if latest');
            let isLatest = true;
            for (let d of existingDocsSamePath) {
                // TODO: use docCompareForOverwrite or something
                if (doc.timestamp < d.timestamp) { isLatest = false; break; }
            }

            // save it
            debug('  > upserting into storageDriver...');
            let success = await this.storageDriver.upsert(doc);
            debug('  > ...done upserting into storageDriver');

            if (!success) { return IngestResult.WriteError; }
            return isLatest
                ? IngestResult.AcceptedAndLatest
                : IngestResult.AcceptedButNotLatest;
        };

        debug('    running protected region...');
        let result: IngestResult;
        if (_getLock) {
            result = await this.storageDriver.lock.run(protectedCode);
        } else {
            // we are already in a lock, just run the code
            result = await protectedCode();
        }
        debug('    ...done running protected region', result);

        debug('    waking followers...');
        // Note: this section of code is outside of the protected region
        // for ingest, but if we get here from set(), we're inside the protected
        // region of set().  We should probably move the code inside the
        // protected region of ingest for consistency.
        // This also means that follower callbacks will not be allowed to call
        // set() or ingest() or they'll deadlock...
        for (let follower of this._followers) {
            if (follower.blocking) {
                // run blocking followers right now
                debug('    - waking a blocking follower');
                // TODO: optimization: if the blocking follower is already up to date,
                // we only need to feed it this one new doc and then it won't
                // have to do a whole query
                await follower.wake();
                debug('    - ...that blocking follower is now done');
            } else {
                // lazy followers can be woken up later
                debug('    - setTimeout for a lazy follower to run later');
                setTimeout(() => {
                    follower.wake();
                }, 0);
            }
        }
        debug('    ...done waking followers');

        return result;
    }
}
