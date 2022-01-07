import { Simplebus } from "../../deps.ts";
import { Query } from "../query/query-types.ts";

import { IStorageAsync, LiveQueryEvent } from "../storage/storage-types.ts";

//================================================================================

export type QueryFollowerState =
    | "new"
    | "catching-up"
    | "live"
    | "closed"
    | "error";

/**
 * Subscribe to the ongoing results of a query,
 * optionaly including old existing docs.
 * When anything happens, emit events on the queryFollower's bus.
 *
 * The bus subscriber callbacks are called blockingly, and so
 * each runs one at a time (one event at a time, and within
 * that event, one callback at a time).
 *
 * Subscribe to events on the bus, with bus.on(cb...).  You
 * will get LiveQueryEvent items, which include:
 *   - DocAlreadyExists -- processing an old doc as you catch up
 *   - IdleEvent -- reached the end of existing docs; waiting for new docs
 *   - IngestEvent
 *   -     IngestEventSuccess -- a new doc was written
 *   -     IngestEventFailure -- refused an invalid doc
 *   -     IngestEventNothingHappened -- ingested an obsolete or duplicate doc
 *   - StorageEventWillClose -- the storage is about to close
 *   - StorageEventDidClose -- the storage has closed
 *   - QueryFollowerDidClose -- the query follower was closed
 *                               (can happen on its own or after the storage closes)
 *
 * The query has some limitations:
 *   - historyMode must be 'all'
 *   - orderBy must be 'localIndex ASC'
 *   - limit cannot be set. (TODO: fix this eventually)
 *
 * The query's startAfter controls the behavior of the live query:
 *   - If startAfter is not set, we begin with the next write event that occurs, and ignore
 *      old/existing documents.
 *   - If startAfter is set to a localIndex value, begin there.  This may involve running
 *      through a backlog of existing documents, then eventually catching up and switching
 *      over to ingest events as new things happen.
 *      The usual use case for this is to set startAfter to localIndex: -1 to begin processing
 *      with the oldest doc (to get all of them).
 *
 *  So the liveQuery can be in two modes:
 *    1. catching up with the backlog
 *    2. caught up; processing new events as they happen.
 *
 * A QueryFollower has a "state" (a QueryFollowerState).
 * Read it with queryFollower.state().  You cannot set it.
 * It can be:
 *
 *  - new -- not running yet; you need to call "await hatch()"
 *  - catching-up -- hatch() has been called, we're catching up on old docs
 *  - live -- we're listening for new write events
 *  - closed -- the query follower is closed
 *  - error -- an unexpected error happened, maybe in your bus subscription handler
 *
 * You can manually close a query follower with close(), and it will also
 * automatically close if the storage closes.
 *
 * To use a QueryFollower, do this:
 *
 *     let qf = new QueryFollower(storage, your_query_here)
 *     qf.bus.on(async (event: LiveQueryEvent) => {
 *         // handle events here
 *         if (event.kind === 'existing' || event.kind === 'success') {
 *             // do something with event.doc
 *         }
 *     });
 *
 *     // after setting up your event handler...
 *     // start processing docs.
 *     await qf.hatch();
 *
 *     // eventually close the storage,
 *     // or at least close the query follower.
 *     // you don't need to do both.
 *     await qf.close();
 *
 * When the query follower is in catching-up mode, it runs independently
 * on its own schedule.  When it's in live mode, it processes each doc
 * as it's written, blockingly (because that's how the storage.bus events
 * work) which means it provides backpressure all the way back up to
 * whatever is trying to ingest() docs into the storage.
 *
 * There is not currently an easy way to know when a query follower has
 * caught up and switched to live mode, except to listen for the 'idle' event
 * on its bus.
 *
 * For now it's tricky to close a query follower from inside its own event handler;
 * you have to do it using setTimeout or you'll deadlock on the bus's lock.
 *      qf.bus.on(await (event) => {
 *          setTimeout(() => qf.close(), 0);
 *      });
 * (...because you can't send an event from inside an event handler)
 */
export interface IQueryFollower {
    storage: IStorageAsync;
    query: Query;

    bus: Simplebus<LiveQueryEvent>;

    state(): QueryFollowerState;

    /**
     * This begins the process of catching up (if needed), then
     * switches to live mode.
     */
    hatch(): Promise<void>;

    /**
     * Shut down the QueryFollower; unhook from the Storage; process no more events.
     * This is permanent.
     * This happens when the storage closes (we've subscribed to storage willClose)
     * and it can also be called manually if you just want to destroy this queryFollower.
     */
    close(): Promise<void>;
}
