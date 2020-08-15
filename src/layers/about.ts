import {
    AuthorAddress,
    AuthorKeypair,
    AuthorShortname,
    EncodedKey,
    IStorage,
    ValidationError,
    WriteResult,
    isErr,
} from '../util/types';
import {
    ValidatorEs4
} from '../validator/es4';

export interface AuthorInfo {
    address : AuthorAddress,
    shortname : AuthorShortname,
    pubkey : EncodedKey,

    // The rest of this info is stored as JSON in a single document
    // at /about/~@suzy.xxxxx/profile.json
    // If the document there does not exist, profile is {}.
    profile: AuthorProfile,
}

export interface AuthorProfile {
    displayName? : string,  // one line of text to use as human-friendly name.  utf-8
    bio? : string,  // paragraph-length description of the person.  utf-8.
    hue? : number,  // theme color.  should be an integer between 0 and 360.  use it as a CSS hue.
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
    getAuthorInfo(authorAddress : AuthorAddress) : AuthorInfo | ValidationError {
        // returns a ValidationError when the given author address is invalid (can't be parsed).
        // Otherwise returns an AuthorInfo object.
        // If there's no profle document found, then authorIfno.profile will be {}.
        // TODO: Should this verify this author has written any docs to the workspace...?
        //       Right now, getAuthorInfo always returns something
        //       even if the author has never written any docs to the workspace.
        let authorParsed = ValidatorEs4.parseAuthorAddress(authorAddress);
        if (isErr(authorParsed)) { return authorParsed; }

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
    setMyAuthorProfile(keypair : AuthorKeypair, profile : AuthorProfile | null, timestamp?: number) : WriteResult | ValidationError {
        // We can only set our own info, so we don't need an author input parameter (it comes from the keypair).
        // Set profile to null or {} to erase your profile (by writing an empty string to your profile document).
        // normally timestamp should be omitted.
        let profileString = (profile === null) ? '' : JSON.stringify(profile);
        if (profileString === '{}') { profileString = ''; }
        return this.storage.set(keypair, {
            format: 'es.4',
            path: LayerAbout.makeProfilePath(keypair.address),
            content: profileString,
            timestamp: timestamp,
        });
    }
}
