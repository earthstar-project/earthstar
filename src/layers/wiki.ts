import {
    AuthorAddress,
    AuthorKeypair,
    IStorage,
    Path,
    QueryOpts,
} from '../util/types';

export interface WikiPageInfo {
    path : Path,
    title : string,
    owner : AuthorAddress | 'shared',  // an author, or 'shared'
}
export interface WikiPageDetail {
    path : Path,
    title : string,
    owner : AuthorAddress | 'shared',  // an author, or 'shared'
    lastAuthor : AuthorAddress,
    timestamp : number,
    text : string,
}

/*
    paths:
    ------
    /wiki/shared/Little%20Snails
    /wiki/~@aaa.xxxxx/Little%20Snails
*/

export class WikiLayer {
    storage : IStorage;
    keypair : AuthorKeypair | null;
    constructor(storage : IStorage, keypair : AuthorKeypair | null) {
        this.storage = storage;
        this.keypair = keypair;
    }
    static makePagePath(owner : AuthorAddress | 'shared', title : string) : string {
        if (owner.startsWith('@')) { owner = '~' + owner; }
        else if (owner !== 'shared') { throw 'invalid wiki page owner: ' + owner; }
        if (!title) { throw 'cannot make wiki page with empty title'; }
        return `/wiki/${owner}/${encodeURIComponent(title)}`;
    }
    static parsePagePath(path : Path) : WikiPageInfo | null {
        if (!path.startsWith('/wiki/')) {
            console.warn('path does not start with "/wiki/":', path);
            return null;
        }
        let ownerAndTitle = path.slice(6);
        let parts = ownerAndTitle.split('/');
        if (parts.length !== 2) {
            console.warn('path has wrong number of path segments:', parts);
            return null;
        }
        let [owner, title] = parts;
        // check owner
        if (!owner.startsWith('~@') && owner !== 'shared') {
            console.warn('invalid wiki owner: ' + owner);
            return null;
        }
        if (owner.startsWith('~')) { owner = owner.slice(1); }
        // check title
        try {
            title = decodeURIComponent(title);
        } catch (e) {
            console.warn('invalid wiki percent-encoding: ' + title);
            return null;
        }
        if (title.length === 0) {
            console.warn('wiki title is an empty string.  invalid.');
            return null;
        }
        return { path: path, owner, title };
    }
    listPageInfos(opts? : {
            owner? : AuthorAddress | 'shared',
            participatingAuthor? : AuthorAddress,
        }): WikiPageInfo[] {
        opts = opts || {};
        let owner = opts.owner;
        let author = opts.participatingAuthor;

        let pathPrefix = '/wiki/';
        if (owner && owner.startsWith('@')) {
            pathPrefix = `/wiki/~${owner}/`;
        } else if (owner === 'shared') {
            pathPrefix = '/wiki/shared/';
        } else if (owner !== undefined) {
            throw 'invalid wiki owner: ' + owner
        }

        let query : QueryOpts = { pathPrefix };
        if (author) { query.participatingAuthor = author; }

        let pageInfoOrNulls = this.storage.paths(query)
            .map(path => WikiLayer.parsePagePath(path));
        let pageInfos = pageInfoOrNulls.filter(pi => pi !== null) as WikiPageInfo[];
        return pageInfos;
    }
    getPageDetails(path : Path) : WikiPageDetail | null {
        let doc = this.storage.getDocument(path);
        if (!doc) {
            console.warn('missing wiki document at path:', path);
            return null;
        }
        let pageInfo = WikiLayer.parsePagePath(path);
        if (pageInfo === null) {
            console.warn('could not parse wiki path: ' + path);
            return null;
        }
        let { owner, title } = pageInfo;
        return {
            path : path,
            title : title,
            owner : owner,
            lastAuthor: doc.author,
            timestamp: doc.timestamp,
            text: doc.value,
        }
    }
    setPageText(path : string, text : string, timestamp? : number) : boolean {
        // normally timestamp should be omitted.
        if (this.keypair === null) {
            return false;
        }
        return this.storage.set(this.keypair, {
            format: 'es.2',
            path: path,
            value: text,
            timestamp: timestamp,
        });
    }
}
