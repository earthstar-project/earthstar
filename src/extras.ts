import {
    AuthorKeypair,
    DocToSet,
    isErr,
    WriteResult,
} from './util/types';
import {
    IStorage,
} from './storage/storageTypes';
import Logger from './util/log'

const storageLogger = new Logger('storage');

// Delete all your documents in a given workspace
// by overwriting them with empty strings.
// Empty documents will be left behind with the original paths
// still observable.
// This will propagate to other peers.
export let deleteMyDocuments = (storage: IStorage, keypair: AuthorKeypair) => {
    let myDocs = storage.documents({
        // include your old versions which are no longer the
        // most recent version
        author: keypair.address,
        history: 'all',
    });
    storageLogger.log(`deleting ${myDocs.length} docs authored by ${keypair.address}...`);
    let numErrors = 0;
    for (let doc of myDocs) {
        let emptyDoc: DocToSet = {
            format: doc.format,
            path: doc.path,
            content: '',
            timestamp: doc.timestamp + 1,
        }
        if (doc.deleteAfter !== null) {
            emptyDoc.deleteAfter = doc.deleteAfter + 1;
        }
        let result = storage.set(keypair, emptyDoc);
        if (isErr(result)) {
            storageLogger.error(`deleting ${doc.path}... error`);
            numErrors += 1;
        } else if (result === WriteResult.Ignored) {
            storageLogger.log(`deleting ${doc.path}... ignored`);
            numErrors += 1;
        } else {
            storageLogger.log(`deleting ${doc.path}... success`);
        }
    }
    storageLogger.log(`done.  ${myDocs.length - numErrors} deleted; ${numErrors} had errors.`);
    return {
        numDeleted: myDocs.length,
        numErrors,
    };
}
