import { WorkspaceAddress, AuthorKeypair } from '../util/types';
import { IStorage3 } from '../storage3/types3';

// an experiment, deciding which is better:

// option 1
export class Workspace {
    storage : IStorage3;
    address : WorkspaceAddress;
    authorKeypair : AuthorKeypair | null;
    constructor(storage : IStorage3, authorKeypair : AuthorKeypair | null) {
        this.storage = storage;
        this.address = storage.workspace;
        this.authorKeypair = authorKeypair;
    }
}

// option 2
interface IWorkspace {
    storage : IStorage3;
    address : WorkspaceAddress;
    authorKeypair : AuthorKeypair | null;
}
let makeWorkspace = (storage : IStorage3, authorKeypair : AuthorKeypair | null) : IWorkspace => ({
    storage: storage,
    address: storage.workspace,
    authorKeypair: authorKeypair,
});

//let workspace1 = new Workspace(new StorageMemory([ValidatorEs4], '+gardening.xxxxx'), null);
//let workspace2 = makeWorkspace(new StorageMemory([ValidatorEs4], '+gardening.xxxxx'), null);

