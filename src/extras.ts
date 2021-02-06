import {
    AuthorKeypair,
    DocToSet,
    isErr,
    IStorage,
    WriteResult,
} from './util/types';

// Delete all your documents in a given workspace
// by overwriting them with empty strings.
// Empty documents will be left behind with the original paths
// still observable.
// This will propagate to other peers.
export let deleteMyDocuments = (storage: IStorage, keypair: AuthorKeypair) => {
    let myDocs = storage.documents({
        // include your old versions which are no longer the
        // most recent version
        versionsByAuthor: keypair.address,
        includeHistory: true,
    });
    console.log(`deleting ${myDocs.length} docs authored by ${keypair.address}...`);
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
            console.log(`deleting ${doc.path}... error`);
            numErrors += 1;
        } else if (result === WriteResult.Ignored) {
            console.log(`deleting ${doc.path}... ignored`);
            numErrors += 1;
        } else {
            console.log(`deleting ${doc.path}... success`);
        }
    }
    console.log(`done.  ${myDocs.length - numErrors} deleted; ${numErrors} had errors.`);
    return {
        numDeleted: myDocs.length,
        numErrors,
    };
}
