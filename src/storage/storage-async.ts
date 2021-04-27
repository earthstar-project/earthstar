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

import { Logger } from '../util/log';
let logger = new Logger('storage async', 'yellowBright');
let loggerSet = new Logger('storage async set', 'yellowBright');
let loggerIngest = new Logger('storage async ingest', 'yellowBright');

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
        logger.debug(`constructor.  driver = ${(driver as any)?.constructor?.name}`);
        this.workspace = workspace;
        this.formatValidator = validator;
        this.storageDriver = driver;
    }

    async getDocsSinceLocalIndex(historyMode: HistoryMode, startAt: LocalIndex, limit?: number): Promise<Doc[]> {
        logger.debug(`getDocsSinceLocalIndex(${historyMode}, ${startAt}, ${limit})`);
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
        logger.debug(`getAllDocs()`);
        return await this.storageDriver.queryDocs({
            historyMode: 'all',
            orderBy: 'path DESC',
        });
    }
    async getLatestDocs(): Promise<Doc[]> {
        logger.debug(`getLatestDocs()`);
        return await this.storageDriver.queryDocs({
            historyMode: 'latest',
            orderBy: 'path DESC',
        });
    }
    async getAllDocsAtPath(path: Path): Promise<Doc[]> {
        logger.debug(`getAllDocsAtPath("${path}")`);
        return await this.storageDriver.queryDocs({
            historyMode: 'all',
            orderBy: 'path DESC',
            filter: { path: path, }
        });
    }
    async getLatestDocAtPath(path: Path): Promise<Doc | undefined> {
        logger.debug(`getLatestDocsAtPath("${path}")`);
        let docs = await this.storageDriver.queryDocs({
            historyMode: 'all',
            orderBy: 'path DESC',
            filter: { path: path, }
        });
        if (docs.length === 0) { return undefined; }
        return docs[0];
    }

    async queryDocs(query: Query = {}): Promise<Doc[]> {
        logger.debug(`queryDocs`, query);
        return await this.storageDriver.queryDocs(query);
    }

    //queryPaths(query?: Query): Path[];
    //queryAuthors(query?: Query): AuthorAddress[];

    //--------------------------------------------------
    // SET

    async set(keypair: AuthorKeypair, docToSet: DocToSet): Promise<IngestResult> {
        loggerSet.debug(`set`, docToSet);
        let protectedCode = async (): Promise<IngestResult> => {
            loggerSet.debug('  + set: start of protected region');
            loggerSet.debug('  | deciding timestamp: getting latest doc at the same path (from any author)');
            // bump timestamp if needed to win over existing latest doc at same path
            let latestDocSamePath = await this.getLatestDocAtPath(docToSet.path);
            let timestamp: number;
            if (latestDocSamePath === undefined) {
                timestamp = microsecondNow();
                loggerSet.debug('  |     no existing latest doc, setting timestamp to now() =', timestamp);
            } else {
                timestamp = Math.max(microsecondNow(), latestDocSamePath.timestamp + 1);
                loggerSet.debug('  |     existing latest doc found, bumping timestamp to win if needed =', timestamp);
            }

            let doc: Doc = {
                format: 'es.4',
                author: keypair.address,
                content: docToSet.content,
                contentHash: this.formatValidator.crypto.sha256base32(docToSet.content),
                deleteAfter: null,
                path: docToSet.path,
                timestamp,
                workspace: docToSet.workspace,
                signature: '?',  // signature will be added in just a moment
                // _localIndex will be added during upsert.  it's not needed for the signature.
            }

            loggerSet.debug('  | signing doc');
            let signedDoc = this.formatValidator.signDocument(keypair, doc);
            if (isErr(signedDoc)) {
                return IngestResult.Invalid;
            }
            loggerSet.debug('  | signature =', signedDoc.signature);

            loggerSet.debug('  | ingesting...');
            let result = await this.ingest(signedDoc, false);  // false means don't get lock again since we're already in the lock
            loggerSet.debug('  | ...done ingesting', result);
            loggerSet.debug('  + set: end of protected region');
            return result;
        }

        loggerSet.debug('  + set: running protected region...');
        let result = await this.storageDriver.lock.run(protectedCode);
        loggerSet.debug('  + set: ...done running protected region.  result =', result);
        loggerSet.debug('set is done.');

        return result;
    }

    async ingest(doc: Doc, _getLock: boolean = true): Promise<IngestResult> {
        loggerIngest.debug(`ingest`, doc);

        loggerIngest.debug('    removing extra fields');
        let removeResultsOrErr = this.formatValidator.removeExtraFields(doc);
        if (isErr(removeResultsOrErr)) { return IngestResult.Invalid; }
        doc = removeResultsOrErr.doc;  // a copy of doc without extra fields
        let extraFields = removeResultsOrErr.extras;  // any extra fields starting with underscores
        if (Object.keys(extraFields).length > 0) {
            loggerIngest.debug(`    ....extra fields found: ${JSON.stringify(extraFields)}`);
        }

        // now actually check doc validity against core schema
        let docIsValid = this.formatValidator.checkDocumentIsValid(doc);
        if (isErr(docIsValid)) { return IngestResult.Invalid; }

        let protectedCode = async (): Promise<IngestResult> => {
            // get other docs at the same path
            loggerIngest.debug(' >> ingest: start of protected region');
            loggerIngest.debug('  > getting other docs at the same path');
            let existingDocsSamePath = await this.getAllDocsAtPath(doc.path);

            // check if this is obsolete or redudant from the same other
            loggerIngest.debug('  > checking if obsolete from same author');
            let existingDocSameAuthor = existingDocsSamePath.filter(d =>
                d.author === doc.author)[0];
            if (existingDocSameAuthor !== undefined) {
                let docComp = docCompareForOverwrite(doc, existingDocSameAuthor);
                if (docComp === Cmp.LT) { return IngestResult.ObsoleteFromSameAuthor; }
                if (docComp === Cmp.EQ) { return IngestResult.AlreadyHadIt; }
            }
        
            // check if latest
            loggerIngest.debug('  > checking if latest');
            let isLatest = true;
            for (let d of existingDocsSamePath) {
                // TODO: use docCompareForOverwrite or something
                if (doc.timestamp < d.timestamp) { isLatest = false; break; }
            }

            // save it
            loggerIngest.debug('  > upserting into storageDriver...');
            let success = await this.storageDriver.upsert(doc);
            loggerIngest.debug('  > ...done upserting into storageDriver');
            loggerIngest.debug(' >> ingest: end of protected region');

            if (!success) { return IngestResult.WriteError; }
            return isLatest
                ? IngestResult.AcceptedAndLatest
                : IngestResult.AcceptedButNotLatest;
        };

        loggerIngest.debug(' >> ingest: running protected region...');
        let result: IngestResult;
        if (_getLock) {
            result = await this.storageDriver.lock.run(protectedCode);
        } else {
            // we are already in a lock, just run the code
            result = await protectedCode();
        }
        loggerIngest.debug(' >> ingest: ...done running protected region', result);

        loggerIngest.debug('  - ingest: waking followers...');
        // Note: this section of code is outside of the protected region
        // for ingest, but if we get here from set(), we're inside the protected
        // region of set().  We should probably move the code inside the
        // protected region of ingest for consistency.
        // This also means that follower callbacks will not be allowed to call
        // set() or ingest() or they'll deadlock...
        for (let follower of this._followers) {
            if (follower.blocking) {
                // run blocking followers right now
                loggerIngest.debug('    - blocking follower: await follower.wake()');
                // TODO: optimization: if the blocking follower is already up to date,
                // we only need to feed it this one new doc and then it won't
                // have to do a whole query
                await follower.wake();
                loggerIngest.debug('    - ...blocking follower is now done');
            } else {
                // lazy followers can be woken up later
                loggerIngest.debug('    - lazy follower: waking it with a setTimeout to wake later');
                setTimeout(() => {
                    follower.wake();
                }, 0);
            }
        }
        loggerIngest.debug('  - ingest: ...done waking followers');

        return result;
    }
}
