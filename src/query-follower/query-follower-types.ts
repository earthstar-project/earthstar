import { Simplebus } from "../../deps.ts";
import { Query } from "../query/query-types.ts";

import { IReplica, LiveQueryEvent } from "../replica/replica-types.ts";

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
 * const myFollower = new QueryFollower(replica, myQuery);
 * myFollower.bus.on(async (event: LiveQueryEvent) => {
 *     if (event.kind === 'existing' || event.kind === 'success') {
 *         doSomething(event.doc)
 *     }
 * });
 *
 * await qf.hatch();
 * ```
 */
export interface IQueryFollower {
  replica: IReplica;
  /**
   * The query being followed. Has some limitations:
   * - `historyMode` must be `all`
   * - `orderBy` must be `localIndex ASC`
   * - limit can NOT be set.
   */
  query: Query;

  /** Use this to subcribe to events with a callback, which will be called blockingly (one event at a time, one callback at a time).
   *
   * For now it's tricky to close a query follower from inside its own event handler; you have to do it using setTimeout or you'll deadlock on the bus's lock.
   * ```ts
   * qf.bus.on(await (event) => {
   *   setTimeout(() => qf.close(), 0);
   * });
   * ```
   * (because you can't send an event from inside an event handler)
   */
  bus: Simplebus<LiveQueryEvent>;

  /** Returns the follower's state, which can be in two modes:
   *   1. catching up with the backlog
   *   2. caught up; processing new events as they happen.
   * When the query follower is in catching-up mode, it runs independently on its own schedule.  When it's in live mode, it processes each doc  as it's written, blockingly, which means it provides backpressure all the way back up to whatever is trying to ingest() docs into the replica.
   * There is not currently an easy way to know when a query follower has caught up and switched to live mode, except to listen for the 'idle' event on its bus.
   */
  state(): QueryFollowerState;

  /** Begins the process of catching up with existing documents (if needed), then switches to live mode. */
  hatch(): Promise<void>;

  /** Permanently shut down the QueryFollower, unhooking from the replica and stopping the processing of events. Automatically called when the followed replica closes. */
  // Triggered when the replica closes
  // Can also be called manually if you just want to destroy this queryFollower.
  close(): Promise<void>;
}
