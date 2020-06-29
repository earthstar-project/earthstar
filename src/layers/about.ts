import {
    AuthorAddress,
    AuthorKeypair,
    AuthorShortname,
    IStorage,
} from '../util/types';
import {
    parseAuthorAddress
} from '../util/addresses';

export interface AuthorProfile {
    address : AuthorAddress,
    shortname : AuthorShortname,
    longname : string | null,  // stored in the document's value.  null if none.
}

/*
    paths:
    ------
    /about/~@aaa.xxxx/name
    /about/~@aaa.xxxx/description    // coming soon
    /about/~@aaa.xxxx/icon           // coming soon
*/
export class LayerAbout {
    storage : IStorage;
    constructor(storage : IStorage) {
        this.storage = storage;
    }
    static makeNamePath(author : AuthorAddress) : string {
        return `/about/~${author}/name`;
    }
    listAuthorProfiles() : AuthorProfile[] {
        // TODO: this only returns people with /about info.  should it also include authors of any document?
        let nameDocs = this.storage.documents({pathPrefix: '/about/'})
            .filter(doc => doc.path.endsWith('/name'));
        let profiles : (AuthorProfile | null)[] = nameDocs.map(doc => {
            let {authorParsed, err} = parseAuthorAddress(doc.author);
            if (err || !authorParsed) { return null; }
            return {
                address: authorParsed.address,
                shortname: authorParsed.shortname,
                longname: doc.value,
            }
        });
        return profiles.filter(x => x !== null) as AuthorProfile[];
    }
    getAuthorProfile(author : AuthorAddress) : AuthorProfile | null {
        let {authorParsed, err} = parseAuthorAddress(author);
        if (err || !authorParsed) { return null; }
        let nameDoc = this.storage.getDocument(LayerAbout.makeNamePath(author));
        let longname = nameDoc === undefined
            ? null
            : (nameDoc.value || null);
        return {
            address: authorParsed.address,
            shortname: authorParsed.shortname,
            longname: longname,
        }
    }
    setMyAuthorLongname(keypair : AuthorKeypair, longname : string, timestamp?: number) : boolean {
        // we can only set our own name, so we don't need an author input parameter.
        // normally timestamp should be omitted.
        return this.storage.set(keypair, {
            format: 'es.2',
            path: LayerAbout.makeNamePath(keypair.address),
            value: longname,
            timestamp: timestamp,
        });
    }
}
