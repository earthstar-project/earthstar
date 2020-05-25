import {
    IStore,
    Item,
    ItemToSet,
    QueryOpts,
    SyncOpts,
    SyncResults,
    WorkspaceId,
} from './types';
import {
    historySortFn,
    itemIsValid,
    signItem
} from './storeUtils';

let log = console.log;
log = (...args : any[]) => void {};  // turn off logging for now

export class StoreMemory implements IStore {
    /*
    This uses an in-memory data structure:
    _items:
    {
        keyA: {
            @author1: {...ITEM...},
            @author2: {...ITEM...},
        }
        keyB: {
            @author1: {...ITEM...},
        }
    }
    _items[key] is never an empty object, it's always missing or contains items.

    Each key can have one item per author.
    Keys with write permissions will only have one author, thus only one item.
    Public keys can have multiple authors, but one is considered the winner
      (with the highest timestamp).
    */
    _items : {[key:string] : {[author:string] : Item}} = {};
    workspace : WorkspaceId;
    constructor(workspace : WorkspaceId) {
        this.workspace = workspace;
    }

    keys(query? : QueryOpts) : string[] {
        // return sorted keys that match the query
        if (query === undefined) { query = {}; }

        // if asking for a single key, check if it exists and return it by itself
        if (query.key !== undefined) {
            if (this._items[query.key] !== undefined) {
                return [query.key];
            } else {
                return [];
            }
        }

        let keys = Object.keys(this._items);
        keys.sort();

        // filter the keys in various ways
        if (query.lowKey !== undefined && query.highKey !== undefined) {
            keys = keys.filter(k =>
                (query?.lowKey as string) <= k && k < (query?.highKey as string));
        }
        if (query.prefix !== undefined) {
            keys = keys.filter(k => k.startsWith(query?.prefix as string));
        }
        if (query.limit) {
            keys = keys.slice(0, query.limit);
        }
        // opts.includeHistory has no effect for keys()
        return keys;
    }
    items(query? : QueryOpts) : Item[] {
        // return items that match the query, sorted by keys.
        // TODO: note that opts.limit applies to the number of keys,
        //   not the number of unique history items

        //log('------------------------------------------ ITEMS');
        //log('query', JSON.stringify(query));
        let includeHistory = query?.includeHistory === true;  // default to false
        let keys = this.keys(query);
        //log('keys', keys);
        let items : Item[] = [];
        for (let key of keys) {
            //log('key', key);
            let keyHistoryItems = Object.values(this._items[key]);
            // sort by timestamp etc
            //log(JSON.stringify(keyHistoryItems, null, 4));
            //log('sorting newest first...');
            keyHistoryItems.sort(historySortFn);
            //log(JSON.stringify(keyHistoryItems, null, 4));
            if (includeHistory) {
                items = items.concat(keyHistoryItems);
            } else {
                items.push(keyHistoryItems[0]);
            }
        }
        return items;
    }
    values(query? : QueryOpts) : string[] {
        // get items that match the query, sort by key, and return their values.
        // TODO: note that opts.limit applies to the number of keys,
        //   not the number of unique history items
        return this.items(query).map(item => item.value);
    }

    getItem(key : string) : Item | undefined {
        // look up the winning value for a single key.
        // return undefined if not found.
        // to get history items for a key, do items({key: 'foo', includeHistory: true})
        if (this._items[key] === undefined) { return undefined; }
        let keyHistoryItems = Object.values(this._items[key]);
        keyHistoryItems.sort(historySortFn);
        return keyHistoryItems[0];
    }
    getValue(key : string) : string | undefined {
        // same as getItem, but just returns the value, not the whole item object.
        return this.getItem(key)?.value;
    }

    ingestItem(item : Item, futureCutoff? : number) : boolean {
        // Given an item from elsewhere, validate, decide if we want it, and possibly store it.
        // Return true if we kept it, false if we rejected it.

        // It can be rejected if it's not the latest one from the same author,
        // or if the item is invalid (signature, etc).

        // Within a single key we keep the one latest item from each author.
        // So this overwrites older items from the same author - they are forgotten.
        // If it's from a new author for this key, we keep it no matter the timestamp.
        // The winning item is chosen at get time, not write time.

        // futureCutoff is a timestamp in microseconds.
        // Messages from after that are ignored.
        // Defaults to now + 10 minutes.
        // This prevents malicious peers from sending very high timestamps.

        if (!itemIsValid(item, futureCutoff)) { return false; }

        // Only accept items from the same workspace.
        if (item.workspace !== this.workspace) { return false; }

        let existingItemsByKey = this._items[item.key] || {};
        let existingFromSameAuthor = existingItemsByKey[item.author];

        // Compare timestamps.
        // Compare signature to break timestamp ties.
        if (existingFromSameAuthor !== undefined
            && [item.timestamp, item.signature]
            <= [existingFromSameAuthor.timestamp, existingFromSameAuthor.signature]
            ) {
            // incoming item is older or identical.  ignore it.
            return false;
        }

        existingItemsByKey[item.author] = item;
        this._items[item.key] = existingItemsByKey;
        return true;
    }

    set(itemToSet : ItemToSet) : boolean {
        // Store a value.
        // schema should normally be omitted so it takes on the default
        // value of the latest version of 'kw.#'.
        // Timestamp is optional and should normally be omitted or set to 0,
        // in which case it will be set to now().
        // (New writes should always have a timestamp of now() except during
        // unit testing or if you're importing old data.)

        itemToSet.timestamp = itemToSet.timestamp || 0;
        let item : Item = {
            schema: itemToSet.schema || 'kw.1',  // TODO: make KW_LATEST var
            workspace: this.workspace,
            key: itemToSet.key,
            value: itemToSet.value,
            author: itemToSet.author,
            timestamp: itemToSet.timestamp > 0 ? itemToSet.timestamp : Date.now()*1000,
            signature: '',
        }
        log(item.timestamp);

        // If there's an existing item from anyone,
        // make sure our timestamp is greater
        // even if this puts us slightly into the future.
        // (We know about the existing item so let's assume we want to supercede it.)
        let existingItemTimestamp = this.getItem(item.key)?.timestamp || 0;
        item.timestamp = Math.max(item.timestamp, existingItemTimestamp+1);

        let signedItem = signItem(item, itemToSet.authorSecret);
        return this.ingestItem(signedItem, item.timestamp);
    }

    _syncFrom(otherStore : IStore, existing : boolean, live : boolean) : number {
        // Pull all items from the other Store and ingest them one by one.

        let numSuccess = 0;
        if (live) {
            // TODO
            throw "live sync not implemented yet";
        }
        if (existing) {
            for (let item of otherStore.items({includeHistory: true})) {
                let success = this.ingestItem(item);
                if (success) { numSuccess += 1; }
            }
        }
        return numSuccess;
    }

    sync(otherStore : IStore, opts? : SyncOpts) : SyncResults {
        // Sync with another Store.
        //   opts.direction: 'push', 'pull', or 'both'
        //   opts.existing: Sync existing values.  Default true.
        //   opts.live (not implemented yet): Continue streaming new changes forever
        // Return the number of items pushed and pulled.
        // This uses a simple and inefficient algorithm.  Fancier algorithm TBD.

        // don't sync with yourself
        if (otherStore === this) { return { numPushed: 0, numPulled: 0 }; }

        // don't sync across workspaces
        if (this.workspace !== otherStore.workspace) { return { numPushed: 0, numPulled: 0}; }

        // set default options
        let direction = opts?.direction || 'both';
        let existing = (opts?.existing !== undefined) ? opts?.existing : true;
        let live = (opts?.live !== undefined) ? opts?.live : false;

        let numPushed = 0;
        let numPulled = 0;
        if (direction === 'pull' || direction === 'both') {
            numPulled = this._syncFrom(otherStore, existing, live);
        }
        if (direction === 'push' || direction === 'both') {
            numPushed = otherStore._syncFrom(this, existing, live);
        }
        return { numPushed, numPulled };
    }
}
