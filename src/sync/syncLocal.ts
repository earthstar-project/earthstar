import {
    SyncResults,
    WriteResult,
} from '../util/types';
import {
    IStorage, IStorageAsync,
} from '../storage/storageTypes';

/**
 * Push all documents from storageA to storageB.
 * Both should be local instances. (on our own local peer, not across the network)
 * 
 * This doesn't use any clever algorithms.
 * It should be rewritten to handle very large workspaces (memory use...)
 * or very slow storages (indexeddb...).
 * 
 * Returns the number of docs successfully pushed (e.g. WriteResult.Accepted)
 */
export let localPush = (storageA: IStorage, storageB: IStorage): number => {
    // return number of docs successfully pushed

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
export let localPushAsync = async (storageA: IStorage | IStorageAsync, storageB: IStorage | IStorageAsync): Promise<number> => {
    // return number of docs successfully pushed

    // don't sync with yourself
    if (storageA === storageB) { return 0; }

    // don't sync across workspaces
    if (storageA.workspace !== storageB.workspace) { return 0; }

    let numSuccess = 0;
    for (let doc of await storageA.documents({ history: 'all' })) {
        let result = await storageB.ingestDocument(doc, storageA.sessionId);
        if (result === WriteResult.Accepted) { numSuccess += 1; }
    }
    return numSuccess;
}

/**
 * Bidirectional sync of all documents between storageA and storageB.
 * Both should be local instances. (on our own local peer, not across the network)
 * 
 * This doesn't use any clever algorithms.
 * It should be rewritten to handle very large workspaces (memory use...)
 * or very slow storages (indexeddb...).
 *
 * Returns the number of docs successfully pushed (e.g. WriteResult.Accepted)
 */
export let localSync = (storageA: IStorage, storageB: IStorage): SyncResults => {
    return {
        numPushed: localPush(storageA, storageB),
        numPulled: localPush(storageB, storageA),
    }
}
export let localSyncAsync = async (storageA: IStorage | IStorageAsync, storageB: IStorage | IStorageAsync): Promise<SyncResults> => {
    return {
        numPushed: await localPushAsync(storageA, storageB),
        numPulled: await localPushAsync(storageB, storageA),
    }
}
