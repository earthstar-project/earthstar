import {
    Superbus
} from 'superbus';

import {
    IStorageAsync
} from '../storage/storage-types';

//================================================================================

export type QueryFollowerEvent = 'close' | 'caught-up';

export interface IQueryFollower {
    storage: IStorageAsync;

    /** Subscribe to events here */
    bus: Superbus<QueryFollowerEvent>;

    /**
     * Call this function and await it when you create a QueryFollower.
     * It gives it time to catch up with the Storage.
     */
    hatch(): Promise<void>;

    /**
     * Is this query follower all caught up with the latest
     * changes from the Storage?
     */
    isCaughtUp(): boolean;

    isClosed(): boolean;

    /**
     * Shut down the QueryFollower; unhook from the Storage; process no more events.
     * This is permanent.
     * This happens when the storage closes (we've subscribed to storage willClose)
     * and it can also be called manually if you just want to destroy this queryFollower.
     */
    close(): Promise<void>;
}
