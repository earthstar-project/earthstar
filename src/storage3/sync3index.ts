import {
    AuthorAddress,
    Document,
    EarthstarError,
    isErr,
    NetworkError,
    Path,
    WriteResult,
} from '../util/types';
import {
    IStorage3,
} from './types3';
import {
    Query3,
} from './query3';
import { logDebug } from '../util/log';

//================================================================================

type Fingerprint = [Path, AuthorAddress, number, string];  // path, author, timestamp, signaturePrefix
type ErrorResponse = {
    sessionId: string,
    error: true,
    message: string,
}
let isErrorResponse = (e: any): e is ErrorResponse =>
    e.error === true;

// from client
type FingerprintIndexRequest = {
    sessionId: string,
    desireQuery: Query3,  // client's desire query (w/ offset)
}
// from server
type FingerprintIndexResponse = {
    sessionId: string,
    //desireQuery: Query3,  // server's desire query
    fingerprints: Fingerprint[],
    //totalResults?: number,  // to help with estimating progress?
}

type BatchFingerprints = {
    sessionId: string,
    fingerprints: Fingerprint[],
}
type BatchDocuments = {
    sessionId: string,
    documents: Document[],
}
type IngestResponse = {
    sessionId: string, // server's id
    accepted: number,  // server ingested it
    obsolete: number,  // server already has newer version
    unwanted: number,  // server's desire query does not match it
    invalid: number,   // bad signature etc
}
type SyncResult = {
    push?: IngestResponse,
    pull?: IngestResponse,
    error?: NetworkError | ErrorResponse,
}


// apply a hard-coded max to the incoming desireQuery.limit to avoid abuse
// TODO: should we hard-code a max limitBytes too?
//let MAX_LIMIT = 10000;  // 10k documents would be 5mb worth of very small docs
//let applyMaxLimit = (query: Query3): Query3 => {
//    let q = {...query};
//    if (q.limit === undefined) { q.limit = MAX_LIMIT; }
//    else { q.limit = Math.min(q.limit, MAX_LIMIT); }
//    return q;
//}

/**
 * The server side of the "index" style efficient sync algorithm.
 * There should be one SyncerServer instance per IStorage (one per workspace).
 * 
 * Typically this would run on a pub.
 * These methods should be exposed over the network via REST or RPC.
 */
class SyncerServer {
    storage: IStorage3;
    //desireQuery: Query3;
    //offerQuery: Query3;
    constructor(storage: IStorage3) { //, desireQuery?: Query3, offerQuery?: Query3) {
        this.storage = storage;
        //this.desireQuery = desireQuery || { history: 'all' };
        //this.offerQuery = offerQuery || { history: 'all' };
    }
    async getFingerprintIndex(request: FingerprintIndexRequest): Promise<FingerprintIndexResponse | ErrorResponse | NetworkError> {
        // return a list of fingerprints that match the request's desireQuery
        logDebug('server.getFingerprintIndex()');
        logDebug(`server.getFingerprintIndex... ${JSON.stringify(request)}`);

        // TODO: enforce JSON schema of request query to avoid trouble
        // TODO: if we can programmatically merge the two queries before executing them, it would be more efficient.
        // Or can we figure out which is more specific and do that one first?
        let fingerprints: Fingerprint[] = this.storage
            .documents(request.desireQuery)
            .map(doc => [doc.path, doc.author, doc.timestamp, doc.signature]);

        logDebug(`server.getFingerprintIndex... returning ${fingerprints.length} fingerprints.  done.`);

        return {
            sessionId: this.storage.sessionId,
            fingerprints: fingerprints,
        };
    }
    async getBatchDocumentsByFingerprint(request: BatchFingerprints): Promise<BatchDocuments | ErrorResponse | NetworkError> {
        // look up the fingerprints and return the corresponding docs
        logDebug(`server.getBatchDocumentsByFingerprint(${request.fingerprints.length} fingerprints...)`);
        let docs: Document[] = [];
        for (let [path, author, timestamp, signature] of request.fingerprints) {
            let doc = this.storage.documents({ path: path, author: author, history: 'all' })[0];
            if (doc === undefined) { continue; }
        }
        logDebug(`server.getBatchDocumentsByFingerprint()... returning ${docs.length} docs.  done.`);
        return {
            sessionId: this.storage.sessionId,
            documents: docs,
        };
    }
    async batchIngestDocuments(request: BatchDocuments): Promise<IngestResponse | ErrorResponse | NetworkError> {
        // ingest a bunch of documents
        logDebug(`server.batchIngestDocuments(${request.documents.length} documents...)`);
        let response : IngestResponse = {
            sessionId: this.storage.sessionId,
            accepted: 0,  // server ingested it
            obsolete: 0,  // server already has newer version
            unwanted: 0,  // server's desire query does not match it
            invalid: 0,   // bad signature etc
        }
        for (let doc of request.documents) {
            let outcome = this.storage.ingestDocument(doc, request.sessionId);
            if (outcome === WriteResult.Accepted) { response.accepted++; }
            if (outcome === WriteResult.Ignored) { response.obsolete++; }
            if (isErr(outcome)) { response.invalid++; }
        }
        return response;
    }
}

/**
 * The client side of the "index" style efficient sync algorithm.
 * There should be one SyncerClient instance per IStorage (one per workspace).
 * 
 * Typically this would run in-browser or in an app, not on a pub.
 * It needs access to a SyncerServer instance, but it will usually be given
 * a proxy object that actually reaches out over the network to talk
 * to a remote SyncerServer over REST or RPC.
 * 
 * The Server side is passive and responds to requests by doing quick queries.
 * The Client side runs a long-running process, figuring out what it wants
 * as it makes requests to the Server.
 * 
 * This whole thing will work p2p also, if both sides will agree on which
 * should be "server" and which "client".
 */
class SyncerClient {
    storage: IStorage3;
    server: SyncerServer; // actually, usually will be a proxy object that does network requests to the real server
    //desireQuery: Query3;
    //offerQuery: Query3;
    constructor(storage: IStorage3, server: SyncerServer) { //, desireQuery?: Query3, offerQuery?: Query3) {
        this.storage = storage;
        this.server = server;
        //this.desireQuery = desireQuery || { history: 'all' };
        //this.offerQuery = offerQuery || { history: 'all' };
    }
    async sync(): Promise<SyncResult> {
        logDebug('client.sync()');

        logDebug('client.sync... getting server fingerprints');
        let serverIndex = await this.server.getFingerprintIndex({
            sessionId: this.storage.sessionId,
            desireQuery: { history: 'all' },
        });
        if (isErrorResponse(serverIndex) || isErr(serverIndex)) {
            return { error: serverIndex };
        }
        let serverFingerprints = serverIndex.fingerprints;

        logDebug('client.sync... getting our own fingerprints');
        let clientFingerprints: Fingerprint[] = this.storage
            .documents({ history: 'all' })
            .map(doc => [doc.path, doc.author, doc.timestamp, doc.signature]);

        // both lists of fingerprints should already be sorted in the same order.
        // walk through both lists, one at a time, to find matches and gaps.
        logDebug(`client.sync... comparing ${clientFingerprints.length} local fingerprints to ${serverFingerprints.length} server fingerprints`);
        let fingerprintsToPush: Fingerprint[] = [];
        let fingerprintsToPull: Fingerprint[] = [];
        let clientF: Fingerprint | undefined = clientFingerprints.pop();
        let serverF: Fingerprint | undefined = serverFingerprints.pop();
        while (true) {
            // every time through this loop we should do exactly one pop() operation
            // to one of the non-empty lists.
            // we stop when they're both empty.
            // therefore it's guaranteed to terminate.
            logDebug('client.sync... -----iteration-----');
            if (clientF === undefined) {
                if (serverF === undefined) {
                    logDebug('    both lists are empty.  done!');
                    break;
                } else {
                    logDebug("    client ran out of fingerprints but server still has at least one.  pulling it.");
                    fingerprintsToPull.push(serverF);
                    serverF = serverFingerprints.pop();
                }
            } else {
                if (serverF === undefined) {
                    logDebug("    server ran out of fingerprints but client still has at least one.  pushing it.");
                    fingerprintsToPush.push(clientF);
                    clientF = clientFingerprints.pop();
                } else {
                    // we have two items to compare
                    let [cPath, cAuthor, cTimestamp, cSig] = clientF;
                    let [sPath, sAuthor, sTimestamp, sSig] = serverF;
                    logDebug(`    comparing two fingerprints...`);
                    if (cPath === sPath && cAuthor === sAuthor) {
                        // matching items!  let's see which is newer
                        // break timestamp ties using signature
                        let clientIsNewer = (cTimestamp > sTimestamp) || (cTimestamp === sTimestamp && cSig < sSig);
                        if (clientIsNewer) {
                            logDebug(`    they match and client is newer.  pushing it.`);
                            fingerprintsToPush.push(clientF);
                            clientF = clientFingerprints.pop();
                        } else {
                            logDebug(`    they match and server is newer.  pulling it.`);
                            fingerprintsToPull.push(serverF);
                            serverF = serverFingerprints.pop();
                        }
                    } else {
                        // items don't match, which order would they sort in a query?
                        // this reveals a gap in one of the lists
                        let clientSortsFirst = (cPath < sPath) || (cPath === sPath && cAuthor < sAuthor);
                        if (clientSortsFirst) {
                            logDebug(`    they don't match and client's sorts first, so the server doesn't have it.  pushing.`);
                            fingerprintsToPush.push(clientF);
                            clientF = clientFingerprints.pop();
                        } else {
                            logDebug(`    they don't match and server's sorts first, so the client doesn't have it.  pulling.`);
                            fingerprintsToPull.push(serverF);
                            serverF = serverFingerprints.pop();
                        }
                    }
                }
            }
        }
        logDebug('client.sync... FINISHED comparing fingerprints.');
        logDebug(`client.sync...     ${fingerprintsToPush.length} to push to server`);
        logDebug(`client.sync...     ${fingerprintsToPull.length} to pull to client`);

        // TODO: push
        //          lookup docs locally
        //          send to server's batchIngest
        // TODO: pull
        //          server.getBatchDocumentsByFingerprint
        //          ingest them locally

        return {};
    }

}

/*

Plan for more efficient sync with remote peers.

Client holds the state of this conversation.
Server is stateless.


CLIENT          SERVER

// request index of fingerprints
--> POST to /server/getFingerprintIndex
{
    sessionId: '123client456',
    query: {
        // this is the client's desire query
        pathPrefix: '/todos/',
        // with some details
        history: 'all'
        continueFrom: [prevPath, prevAuthor],
        sort: 'path-author',
        limit: 100,
    },
}

                // return index:
                <--
                {
                    sessionId: '888server888',
                    desireQuery: {
                        // the server's desire query
                        timestamp_gt: 150000000,
                    }
                    queryResults: [
                        // index of document fingerprints that match client's desireQuery and server's offerQuery
                        // sorted by [path, author]
                        // path          author             timestamp     signature.slice(0, 10)
                        ['/todos/1.txt', '@suzy.boqigjaoi', 158243243000, 'bjfqjfjaiweofj'],
                        ['/todos/1.txt', '@zzzz.bjfo2i3fj', 140000000000, 'bvoaevijofhaih'],
                        ['/todos/2.txt', '@aaaa.bqwjo4fiq', 151309137734, 'boiajhaorhrhia'],
                        ... 100 of them
                    ],
                }

// client also does the same search on itself.
// client figures out which side's results extend further and trim off the extra.

let docsToPull: fingerprint[] = (serverDocs - myDocs) filtered through client's desire query
let docsToPush: fingerprint[] = (myDocs - serverDocs) filtered through client's offer query and server's desire query

// client pulls by fingerprint
--> POST /server/batchGetDocumentsByFingerprint
{
    sessionId: '123client456',
    fingerprints: [
        ['/todos/1.txt', '@zzzz.bjfo2i3fj', 140000000000, 'bvoaevijofhaih'],
        ...
    ]
}
                // server double-checks it's willing to offer these docs
                // server responds with docs
                <--
                {
                    sessionId: '888server888',
                    documents: [
                        { actual doc 1 },
                        { actual doc 2 },
                        ...
                    ]
                }

// client double-checks those against its desire query
// client ingests docs from server


// push
--> POST /server/batchIngestDocuments
{
    sessionId: '123client456',
    documents: [
        { actual doc 1 },
        { actual doc 2 },
        ...
    ]
}

                // server double-checks it desires these docs
                // server ingests the docs
                <--
                {
                    sessionId: '888server888',
                    ingested: 7,
                    ignored: 3,
                }







*/
