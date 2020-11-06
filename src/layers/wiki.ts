import {
    AuthorAddress,
    AuthorKeypair,
    IStorage,
    NotFoundError,
    Path,
    QueryOpts,
    ValidationError,
    WriteResult,
    isErr,
    notErr,
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
          OWNER / TITLE (percent-encoded)

    /wiki/shared/Little%20Snails
    /wiki/~@aaaa.xxxxx/Little%20Snails
*/

/**
 * An example Layer for a wiki app.
 * 
 * This is just an example and has gotten old.
 * 
 * @deprecated
 */
export class LayerWiki {
    storage : IStorage;
    constructor(storage : IStorage) {
        this.storage = storage;
    }
    static makePagePath(owner : AuthorAddress | 'shared', title : string) : string | ValidationError {
        // TODO: return an error instead of throwing
        if (owner.startsWith('@')) { owner = '~' + owner; }
        else if (owner !== 'shared') { return new ValidationError('invalid wiki page owner: ' + owner); }
        if (!title) { return new ValidationError('cannot make wiki page with empty title'); }
        return `/wiki/${owner}/${encodeURIComponent(title)}.md`;
    }
    static parsePagePath(path : Path) : WikiPageInfo | ValidationError {
        if (!path.startsWith('/wiki/')) {
            return new ValidationError('path does not start with "/wiki/": ' + path);
        }
        if (!path.endsWith('.md')) {
            return new ValidationError('path does not end with ".md": ' + path);
        }
        let pathNoMd = path.slice(0, -3);  // remove '.md'
        let ownerAndTitle = pathNoMd.slice(6);
        let parts = ownerAndTitle.split('/');
        if (parts.length !== 2) {
            return new ValidationError('path has wrong number of path segments: ' + JSON.stringify(parts));
        }
        let [owner, title] = parts;
        // check owner
        if (!owner.startsWith('~@') && owner !== 'shared') {
            return new ValidationError('invalid wiki owner: ' + owner);
        }
        if (owner.startsWith('~')) { owner = owner.slice(1); }
        // check title
        try {
            title = decodeURIComponent(title);
        } catch (e) {
            return new ValidationError('invalid wiki percent-encoding: ' + title);
        }
        if (title.length === 0) {
            return new ValidationError('wiki title is an empty string.  invalid.');
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
            .map(path => LayerWiki.parsePagePath(path));
        let pageInfos = pageInfoOrNulls.filter(pi => notErr(pi)) as WikiPageInfo[];
        return pageInfos;
    }
    getPageDetails(path : Path) : WikiPageDetail | ValidationError | NotFoundError {
        let pageInfo = LayerWiki.parsePagePath(path);
        if (isErr(pageInfo)) { return pageInfo; }

        let doc = this.storage.getDocument(path);
        if (!doc) {
            return new NotFoundError('missing wiki document at path: ' + path);
        }

        let { owner, title } = pageInfo;
        return {
            path : path,
            title : title,
            owner : owner,
            lastAuthor: doc.author,
            timestamp: doc.timestamp,
            text: doc.content,
        }
    }
    setPageText(keypair : AuthorKeypair, path : string | ValidationError, text : string, timestamp? : number) : WriteResult | ValidationError {
        // normally timestamp should be omitted.
        if (isErr(path)) { return path; }
        return this.storage.set(keypair, {
            format: 'es.4',
            path: path,
            content: text,
            timestamp: timestamp,
        });
    }
}
