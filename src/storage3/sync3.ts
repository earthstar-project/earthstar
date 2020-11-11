import {
    SyncResults,
    WriteResult,
} from '../util/types';
import {
    IStorage3,
} from './types3';

//================================================================================

export let storage3Push = (storageA: IStorage3, storageB: IStorage3): number => {
    // return number successfully pushed

    // don't sync with yourself
    if (storageA === storageB) { return 0; }
    // don't sync across workspaces
    if (storageA.workspace !== storageB.workspace) { return 0; }

    let numSuccess = 0;
    for (let doc of storageA.documents({ history: 'all' })) {
        let result = storageB.ingestDocument(doc, false);
        if (result === WriteResult.Accepted) { numSuccess += 1; }
    }
    return numSuccess;
}

export let storage3Sync = (storageA: IStorage3, storageB: IStorage3): SyncResults => {
    return {
        numPushed: storage3Push(storageA, storageB),
        numPulled: storage3Push(storageB, storageA),
    }
}
