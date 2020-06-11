//import {
//    IStore, Keypair, ItemToSet,
//} from 'earthstar';
//
//export interface WikiPageInfo {
//    key : string,
//    title : string,
//    owner : string,  // an author, or 'shared'
//}
//export interface WikiPageDetail {
//    key : string,
//    title : string,
//    owner : string,  // an author, or 'shared'
//    lastAuthor : string,
//    timestamp : number,
//    text : string,
//}
//
///*
//    keys are like
//
//    wiki/shared/Little%20Snails
//    wiki/~@aaa/Little%20Snails
//*/
//
//export class WikiLayer {
//    es : IStore;
//    keypair : Keypair
//    constructor(es : IStore, keypair : Keypair) {
//        this.es = es;
//        this.keypair = keypair;
//    }
//    static makeKey(title : string, owner : string) : string {
//        if (owner.startsWith('@')) { owner = '~' + owner; }
//        return `wiki/${owner}/${encodeURIComponent(title)}`;
//    }
//    static parseKey(key : string) : WikiPageInfo | null {
//        if (!key.startsWith('wiki/')) {
//            console.warn('key does not start with "wiki/":', key);
//            return null;
//        }
//        let ownerTitle = key.slice(5);
//        let parts = ownerTitle.split('/');
//        if (parts.length !== 2) {
//            console.warn('key has wrong number of path segments:', parts);
//            return null;
//        }
//        let [owner, title] = parts;
//        title = decodeURIComponent(title);
//        if (owner.startsWith('~')) { owner = owner.slice(1); }
//        return { key, owner, title };
//    }
//    listPages() : WikiPageInfo[] {
//        let pageInfoOrNulls = this.es.keys({prefix: 'wiki/'})
//            .map(key => WikiLayer.parseKey(key));
//        let pageInfos = pageInfoOrNulls.filter(pi => pi !== null) as WikiPageInfo[];
//        return pageInfos;
//    }
//    getPageDetails(key : string) : WikiPageDetail | null {
//        let item = this.es.getItem(key);
//        if (!item) {
//            console.warn('missing key:', key);
//            return null;
//        }
//        let pageInfo = WikiLayer.parseKey(key);
//        if (pageInfo === null) { return null; }
//        let { owner, title } = pageInfo;
//        return {
//            key : key,
//            title : title,
//            owner : owner,
//            lastAuthor: item.author,
//            timestamp: item.timestamp,
//            text: item.value,
//        }
//    }
//    setPageText(key : string, text : string, timestamp? : number) : boolean {
//        return this.es.set(this.keypair, {
//            format: 'es.1',
//            key: key,
//            value: text,
//            timestamp: timestamp,
//        });
//    }
//}