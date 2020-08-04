import {
    AuthorAddress,
    AuthorKeypair,
    AuthorShortname,
    IStorage,
    EncodedKey,
    ValidationError,
    AuthorParsed,
} from '../util/types';
import {
    ValidatorNew_Es4
} from '../validator/es4new';

export interface AuthorInfo {
    address : AuthorAddress,
    shortname : AuthorShortname,
    pubkey : EncodedKey,

    // The rest of this info is stored as JSON in a single document
    // at /about/~@suzy.xxxxx/profile .
    // Even if the document has never been written, this will
    // return a content of {}.
    profile: AuthorProfile,
}

export interface AuthorProfile {
    longname? : string,
    bio? : string,  // paragraph-length description of the person
    hue? : number,  // theme color.  should be an integer between 0 and 360.
}

export class LayerAbout {
    storage : IStorage;
    constructor(storage : IStorage) {
        this.storage = storage;
    }
    static makeProfilePath(author : AuthorAddress) : string {
        return `/about/~${author}/profile.json`;
    }
    listAuthorInfos() : AuthorInfo[] {
        let authorAddresses = this.storage.authors();
        let infos = authorAddresses.map(authorAddress => this.getAuthorInfo(authorAddress));
        return infos.filter(x => x !== null) as AuthorInfo[];
    }
    getAuthorInfo(authorAddress : AuthorAddress) : AuthorInfo | null {
        // returns null when the given author address is invalid (can't be parsed).
        // otherwise returns an object, within which the profile might be an empty object
        // if there's no profile document for this author.
        // TODO: this doesn't verify this author has ever written to the workspace...?
        let authorParsed : AuthorParsed;
        try {
            authorParsed = ValidatorNew_Es4.parseAuthorAddress(authorAddress);
        } catch (err) {
            if (err instanceof ValidationError) { return null; }
            throw err;
        }
        let info : AuthorInfo = {
            address: authorParsed.address,
            shortname: authorParsed.shortname,
            pubkey: authorParsed.pubkey,
            profile: {},
        }
        let profilePath = LayerAbout.makeProfilePath(authorAddress);
        let profileJson = this.storage.getContent(profilePath);
        if (profileJson) {
            try {
                info.profile = JSON.parse(profileJson);
            } catch (e) {
            }
        }
        return info;
    }
    setMyAuthorProfile(keypair : AuthorKeypair, profile : AuthorProfile | null, timestamp?: number) : boolean {
        // we can only set our own info, so we don't need an author input parameter.
        // set profile to null to erase your profile (by writing an empty string to your profile document).
        // normally timestamp should be omitted.
        return this.storage.set(keypair, {
            format: 'es.4',
            path: LayerAbout.makeProfilePath(keypair.address),
            content: profile === null ? '' : JSON.stringify(profile),
            timestamp: timestamp,
        });
    }
}
