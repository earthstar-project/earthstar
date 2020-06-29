import { WorkspaceAddress, IStorage, AuthorKeypair } from './util/types';
import { Syncer } from './sync';
import { LayerAbout } from './layers/about';
import { LayerWiki } from './layers/wiki';

// an experiment, deciding which is better:

// option 1
export class Workspace {
    storage : IStorage;
    address : WorkspaceAddress;
    authorKeypair : AuthorKeypair | null;
    syncer : Syncer;
    layerAbout : LayerAbout;
    layerWiki : LayerWiki;
    constructor(storage : IStorage, authorKeypair : AuthorKeypair | null) {
        this.storage = storage;
        this.address = storage.workspace;
        this.authorKeypair = authorKeypair;
        this.syncer = new Syncer(storage);
        this.layerAbout = new LayerAbout(storage);
        this.layerWiki = new LayerWiki(storage);
    }
}

// option 2
interface IWorkspace {
    storage : IStorage;
    address : WorkspaceAddress;
    authorKeypair : AuthorKeypair | null;
    syncer : Syncer;
    layerAbout : LayerAbout;
    layerWiki : LayerWiki;
}
let makeWorkspace = (storage : IStorage, authorKeypair : AuthorKeypair | null) : IWorkspace => ({
    storage: storage,
    address: storage.workspace,
    authorKeypair: authorKeypair,
    syncer: new Syncer(storage),
    layerAbout: new LayerAbout(storage),
    layerWiki: new LayerWiki(storage),
});

//let workspace1 = new Workspace(new StorageMemory([ValidatorEs3], '+gardening.xxxxx'), null);
//let workspace2 = makeWorkspace(new StorageMemory([ValidatorEs3], '+gardening.xxxxx'), null);

