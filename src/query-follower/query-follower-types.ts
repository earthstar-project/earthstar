import { Simplebus } from "../../deps.ts";
import { Query } from "../query/query-types.ts";

import { IStorageAsync, LiveQueryEvent } from "../storage/storage-types.ts";

//================================================================================

/**
 * - `new` — not running yet; you need to call "await hatch()".
 * - `catching-up` — hatch() has been called, we're catching up on old docs.
 * - `live` — we're listening for new write events.
 * - `closed` — the query follower is closed.
 * - `error` — an unexpected error happened, maybe in your bus subscription handler.
 */
export type QueryFollowerState =
    | "new"
    | "catching-up"
    | "live"
    | "closed"
    | "error";

/**
 * Subscribe to the ongoing results of a query, optionally including old existing docs.
 *  ```
 * const myFollower = new QueryFollower(storage, myQuery);
 * myFollower.bus.on(async (event: LiveQueryEvent) => {
 *     if (event.kind === 'existing' || event.kind === 'success') {
 *         doSomething(event.doc)
 *     }
 * });
 *
 * await qf.hatch();
 * ```
 */

// The query's startAfter controls the behavior of the live query:
// - If startAfter is not set, we begin with the next write event that occurs, and ignore
//      old/existing documents.
//   - If startAfter is set to a localIndex value, begin there.  This may involve running
//      through a backlog of existing documents, then eventually catching up and switching
//      over to ingest events as new things happen.
//      The usual use case for this is to set startAfter to localIndex: -1 to begin processing
//      with the oldest doc (to get all of them).
//
//  So the liveQuery can be in two modes:
//    1. catching up with the backlog
//    2. caught up; processing new events as they happen.
//
// You can manually close a query follower with close(), and it will also
// automatically close if the storage closes.
//
// When the query follower is in catching-up mode, it runs independently
// on its own schedule.  When it's in live mode, it processes each doc
// as it's written, blockingly (because that's how the storage.bus events
// work) which means it provides backpressure all the way back up to
// whatever is trying to ingest() docs into the storage.
//
// There is not currently an easy way to know when a query follower has
// caught up and switched to live mode, except to listen for the 'idle' event
// on its bus.
//
// For now it's tricky to close a query follower from inside its own event handler;
// you have to do it using setTimeout or you'll deadlock on the bus's lock.
//      qf.bus.on(await (event) => {
//          setTimeout(() => qf.close(), 0);
//      });
// (...because you can't send an event from inside an event handler)
export interface IQueryFollower {
    storage: IStorageAsync;
    /**
     * The query being followed. Has some limitations:
     * - `historyMode` must be `all`
     * - `orderBy` must be `localIndex ASC`
     * - limit can NOT be set.
     */
    query: Query;

    /**
     * Use this to subcribe to events with a callback, which will be called blockingly (one event at a time, one callback at a time).
     */
    bus: Simplebus<LiveQueryEvent>;

    state(): QueryFollowerState;

    /** Begins the process of catching up with existing documents (if needed), then switches to live mode.
     */
    hatch(): Promise<void>;

    /** Permanently shut down the QueryFollower, unhooking from the storage and stopping the processing of events. */
    // Triggered when the storage closes
    // Can also be called manually if you just want to destroy this queryFollower.
    close(): Promise<void>;
}
