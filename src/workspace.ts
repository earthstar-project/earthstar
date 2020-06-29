import { WorkspaceAddress, IStorage, AuthorKeypair } from './util/types';
import { Syncer } from './sync';
import { AboutLayer } from './layers/about';
import { WikiLayer } from './layers/wiki';

export class Workspace {
    storage : IStorage;
    address : WorkspaceAddress;
    syncer : Syncer;
    keypair : AuthorKeypair | null;
    layerAbout : AboutLayer;
    layerWiki : WikiLayer;
    constructor(address : WorkspaceAddress, storage : IStorage, keypair : AuthorKeypair | null) {
        this.address = address;
        this.storage = storage;
        this.syncer = new Syncer(storage);
        this.keypair = keypair;
        this.layerAbout = new AboutLayer(storage);
        this.layerWiki = new WikiLayer(storage);
    }
}
