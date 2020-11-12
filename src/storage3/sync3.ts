import {
    AuthorAddress,
    NetworkError,
    Path,
    SyncResults,
    WriteResult,
} from '../util/types';
import {
    IStorage3,
} from './types3';
import {
    Query3,
} from './query3';

//================================================================================

export let storage3LocalPush = (storageA: IStorage3, storageB: IStorage3): number => {
    // return number successfully pushed

    // don't sync with yourself
    if (storageA === storageB) { return 0; }
    // don't sync across workspaces
    if (storageA.workspace !== storageB.workspace) { return 0; }

    let numSuccess = 0;
    for (let doc of storageA.documents({ history: 'all' })) {
        let result = storageB.ingestDocument(doc, storageA.sessionId);
        if (result === WriteResult.Accepted) { numSuccess += 1; }
    }
    return numSuccess;
}

export let storage3LocalSync = (storageA: IStorage3, storageB: IStorage3): SyncResults => {
    return {
        numPushed: storage3LocalPush(storageA, storageB),
        numPulled: storage3LocalPush(storageB, storageA),
    }
}

//================================================================================

type Fingerprint = [Path, AuthorAddress, number, string];  // path, author, timestamp, signaturePrefix
type ErrorResponse = {
    sessionId: string,
    error: true,
    message: string,
}

// from client
type FingerprintIndexRequest = {
    sessionId: string,
    desireQuery: Query3,  // client's desire query
}
// from server
type FingerprintIndexResponse = {
    sessionId: string,
    desireQuery: Query3,  // server's desire query
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
    sessionId: string,
    ingested: number,  // server ingested it
    obsolete: number,  // server already has newer version
    unwanted: number,  // server's desire query does not match it
    invalid: number,   // bad signature etc
}
type SyncResult = {
    push?: IngestResponse,
    pull?: IngestResponse,
}

// this is the "banana" version of the protocol
// server methods
// this needs 2 adapters built:
// this class is just the algorithm
// it needs to be hooked up to Express on the server side,
// and it needs a proxy to run on the client that makes it look local but actually fetches over the network
class ServerSyncBanana {
    constructor(public storage: IStorage3) {}
    async getFingerprintIndex(request: FingerprintIndexRequest): Promise<FingerprintIndexResponse | ErrorResponse | NetworkError> {
        return null as any;
    }
    async getBatchDocumentsByFingerprint(request: BatchFingerprints): Promise<BatchDocuments | ErrorResponse | NetworkError> {
        return null as any;
    }
    async batchPushDocuments(request: BatchDocuments): Promise<IngestResponse | ErrorResponse | NetworkError> {
        return null as any;
    }
}

class ClientSyncBanana {
    // serverBanana will be a proxy that goes over the network but looks local
    constructor(public storage: IStorage3, public serverBanana: ServerSyncBanana) {}
    async sync(): Promise<SyncResult> {
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
--> POST /server/batchPushDocuments
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
