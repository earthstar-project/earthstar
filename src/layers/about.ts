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
export class AboutLayer {
    storage : IStorage;
    keypair : AuthorKeypair | null;
    constructor(storage : IStorage, keypair : AuthorKeypair | null) {
        this.storage = storage;
        this.keypair = keypair;
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
        let nameDoc = this.storage.getDocument(AboutLayer.makeNamePath(author));
        let longname = nameDoc === undefined
            ? null
            : (nameDoc.value || null);
        return {
            address: authorParsed.address,
            shortname: authorParsed.shortname,
            longname: longname,
        }
    }
    setMyAuthorLongname(longname : string, timestamp?: number) : boolean {
        // we can only set our own name, so we don't need an author input parameter.
        // normally timestamp should be omitted.
        if (this.keypair === null) {
            return false;
        }
        return this.storage.set(this.keypair, {
            format: 'es.2',
            path: AboutLayer.makeNamePath(this.keypair.address),
            value: longname,
            timestamp: timestamp,
        });
    }
}
