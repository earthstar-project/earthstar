import { cloneDeep, Simplebus } from "../../deps.ts";

import { Thunk } from "../replica/util-types.ts";
import { Query } from "../query/query-types.ts";
import { NotImplementedError, ReplicaIsClosedError } from "../util/errors.ts";
import {
  DocAlreadyExists,
  IdleEvent,
  IReplica,
  LiveQueryEvent,
  QueryFollowerDidClose,
  ReplicaBusChannel,
  ReplicaEventDidClose,
  ReplicaEventWillClose,
} from "../replica/replica-types.ts";
import { docMatchesFilter } from "../query/query.ts";
import { IQueryFollower, QueryFollowerState } from "./query-follower-types.ts";

//================================================================================

import {
  Logger,
  LogLevel,
  setDefaultLogLevel,
  setLogLevel,
} from "../util/log.ts";
import { sleep } from "../util/misc.ts";
let logger = new Logger("QueryFollower", "brightRed");
let loggerSub = new Logger("QueryFollowerSub", "red");
let J = JSON.stringify;

//setLogLevel('QueryFollower', LogLevel.Debug);
//setLogLevel('QueryFollowerSub', LogLevel.Debug);

//================================================================================

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
export class QueryFollower implements IQueryFollower {
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
  _state: QueryFollowerState = "new";
  _unsub: Thunk | null = null; // to unsub from replica events

  /**
   * Create a new QueryFollower
   * @param query - The query to be followed. Has some limitations: `historyMode` must be `all`; `orderBy` must be `localIndex ASC`; `limit` can *not* be set. The query's `startAfter` controls the behaviour of the follower: if not set, we begin with the next write event that occurs, and ignore existing documents; if `startAfter` is set to a `localIndex` value, we begin there. The usual case is to set `startAfter` to -1 to process all documents.
   */
  constructor(replica: IReplica, query: Query) {
    logger.debug("constructor");
    this.replica = replica;
    this.query = cloneDeep(query); // we'll modify the query as we go, changing the startAfter
    this.bus = new Simplebus<LiveQueryEvent>();

    // enforce rules on supported queries
    logger.debug("...enforcing rules on supported queries");
    if (query.historyMode !== "all") {
      throw new NotImplementedError(
        `QueryFollower historyMode must be 'all'`,
      );
    }
    if (query.orderBy !== "localIndex ASC") {
      throw new NotImplementedError(
        `QueryFollower orderBy must be 'localIndex ASC'`,
      );
    }
    if (query.limit !== undefined) {
      throw new NotImplementedError(
        `QueryFollower must not have a limit`,
      );
    }
  }

  _expectState(states: QueryFollowerState[]) {
    if (states.indexOf(this._state) === -1) {
      throw new Error(
        `QueryFollower expected state to be one of ${
          J(states)
        } but instead found ${this._state}`,
      );
    }
  }

  /** Returns the follower's state, which can be in two modes:
   *   1. catching up with the backlog
   *   2. caught up; processing new events as they happen.
   * When the query follower is in catching-up mode, it runs independently on its own schedule.  When it's in live mode, it processes each doc  as it's written, blockingly, which means it provides backpressure all the way back up to whatever is trying to ingest() docs into the storage.
   * There is not currently an easy way to know when a query follower has caught up and switched to live mode, except to listen for the 'idle' event on its bus.
   */
  state(): QueryFollowerState {
    logger.debug("state() => " + this._state);
    return this._state;
  }

  /** Begins the process of catching up with existing documents (if needed), then switches to live mode.
   */
  async hatch(): Promise<void> {
    logger.debug("hatch...");

    this._expectState(["new"]);

    logger.debug("...hatch: calling _catchUp");
    await this._catchUp();
    this._expectState(["closed", "error", "live"]);
    logger.debug("...hatch: done calling _catchUp");
    logger.debug(`...hatch: state is "${this._state}"`);

    logger.debug(`...hatch is done`);
  }

  async _catchUp(): Promise<void> {
    // call this from state "new"
    // pass through state "catching-up"
    // end in state:
    //  "live" is we finished catching up and started the live subscription to the storage
    //  "closed" if storage became closed
    //  "error" if something else happened, probably an error from the bus handler

    logger.debug("_catchUp...");
    this._expectState(["new"]);

    let storage = this.replica;
    let driver = this.replica.replicaDriver;
    let query = this.query;

    if (query.startAfter === undefined) {
      logger.debug(
        `..._catchUp was not needed becaue startAfter is undefined, so we're going right to live mode.`,
      );
      this._state = "live";
      // the moment we become live, we're idle
      let idleEvent: IdleEvent = { kind: "idle" };
      await this.bus.send(idleEvent);
      this._subscribe();
      return;
    }

    // catch up if needed
    this._state = "catching-up";
    logger.debug(`QueryFollower has a startAfter already; catching up.`);
    while (true) {
      let asOf1: number = -100; // before query
      let asOf2: number = -100; // after query; before callbacks, doesn't really matter
      let asOf3: number = -100; // after callbacks
      let maxReturned: number = -100;
      // do a query
      try {
        asOf1 = driver.getMaxLocalIndex();
        logger.debug(
          `...at ${asOf1}, started querying for existing docs`,
        );
        // TODO: catch up in smaller batches by setting a limit in the query
        // TODO: check often to see if the queryfollower itself has been closed
        let existingDocs = await storage.queryDocs(query);
        for (let doc of existingDocs) {
          maxReturned = Math.max(maxReturned, doc._localIndex ?? -1);
        }
        asOf2 = driver.getMaxLocalIndex();
        logger.debug(
          `...at ${asOf2}, got ${existingDocs.length} existing docs`,
        );
        logger.debug(`...sending docs to bus...`);
        for (let doc of existingDocs) {
          let event: DocAlreadyExists = {
            kind: "existing",
            maxLocalIndex: asOf2,
            doc: doc, // TODO: should be the just-written doc, frozen, with updated extra properties like _localIndex
          };
          await this.bus.send(event);
        }
        asOf3 = driver.getMaxLocalIndex();
        logger.debug(
          `...at ${asOf3}, finished running ${existingDocs.length} callbacks for existing docs`,
        );
      } catch (err) {
        if (err instanceof ReplicaIsClosedError) {
          logger.debug(
            `storage was closed while we were catching up, oh well.`,
          );
          this.close();
        } else {
          // TODO: what now?  are we stuck in 'error' state?
          // should we close?
          this._state = "error";
          throw err;
        }
      }

      // check for stopping conditions for query catch-up loop
      let asOfSummary =
        `( asOf: ${asOf1} [query] ${asOf2} [callbacks] ${asOf3}.  maxReturned: ${maxReturned} )`;
      logger.debug(`...query and callback summary: ${asOfSummary}`);
      if (asOf1 === asOf3) {
        logger.debug(
          `...asOf stayed at ${asOf1} so nothing new has happened since we did the query, so we can stop catching up now.`,
        );
        logger.debug(`...setting startAfter to localIndex: ${asOf1}`);
        // no changes; we can stop catching up
        // and let's set startAfter to continue where we just left off.
        query.startAfter = { localIndex: asOf1 };
        this._state = "live";
        // the moment we become live, we're idle
        let idleEvent: IdleEvent = { kind: "idle" };
        await this.bus.send(idleEvent);
        this._subscribe();
        break;
      } else {
        // changes happened.
        // wait a moment, then do another query to keep catching up.
        logger.debug(
          `...asOf went from ${asOf1} to ${asOf3} so changes happened since we did our query; gotta query again to get those changes.`,
        );
        logger.debug(
          `...setting startAfter to localIndex: ${maxReturned} which is the max returned doc we saw.`,
        );
        query.startAfter = { localIndex: maxReturned };
        await sleep(10);
      }
    } // end of while(true) loop

    logger.debug(
      `..._catchUp is done, we should now be live: '${this.state()}'`,
    );
    this._expectState(["live"]);
  }

  _subscribe() {
    // if query did not specify a startAfter, we will start with the next
    // ingest event that happens.

    // we have just entered live mode, so we need to subscribe to new events.
    // we'll return an unsubscribe function.

    logger.debug("_subscribe...");
    this._expectState(["live"]);

    let driver = this.replica.replicaDriver;
    let query = this.query;

    let queryFilter = query.filter || {};
    let queryStartAfter = driver.getMaxLocalIndex();
    if (
      query.startAfter !== undefined &&
      query.startAfter.localIndex !== undefined
    ) {
      queryStartAfter = query.startAfter.localIndex;
    }
    logger.debug(`QueryFollower is switching to subscription mode:`);
    logger.debug(`...queryFilter: ${J(queryFilter)}`);
    logger.debug(
      `...start paying attention after local index ${queryStartAfter}.  subscribing...`,
    );

    this._unsub = this.replica.bus.on(
      "*",
      async (channel: ReplicaBusChannel | "*", data: any) => {
        this._expectState(["live"]); // make sure the query follower itself has not been closed

        loggerSub.debug(
          `--- QueryFollower subscription: got an event on channel ${channel}`,
        );
        let event = data as LiveQueryEvent;
        if (channel === "willClose") {
          let event: ReplicaEventWillClose = {
            kind: "willClose",
            maxLocalIndex: driver.getMaxLocalIndex(),
          };
          await this.bus.send(event);
        } else if (channel === "didClose") {
          let event: ReplicaEventDidClose = {
            kind: "didClose",
          };
          loggerSub.debug(
            "storage did close.  sending that event...",
          );
          await this.bus.send(event);
          loggerSub.debug(
            "storage did close.  ...and closing the queryFollower...",
          );
          await this.close();
          loggerSub.debug("storage did close.  ...done.");
        } else if (data === undefined || data.kind === undefined) {
          loggerSub.error("weird event on channel ", channel);
          return;
          // ingest events
        } else if (event.kind === "success") {
          // let events through that are after our query's startAfter
          // and match our query's filter
          loggerSub.debug(`--- it's a write success.  do we care?`);
          let doc_li = event.doc._localIndex ?? -1;
          let query_sa = queryStartAfter;
          if (doc_li <= query_sa) {
            loggerSub.debug(
              `--- don't care; localIndex is old (doc.localIndex ${doc_li} <= queryStartAfter ${query_sa})`,
            );
          } else {
            if (!docMatchesFilter(event.doc, queryFilter)) {
              loggerSub.debug(
                `--- don't care; filter doesn't match`,
              );
            } else {
              loggerSub.debug(
                `--- we care! filter matches (if there is one) and doc.localIndex comes after query.startAt.`,
              );
              loggerSub.debug(
                `--- running callback blockingly...`,
              );
              await this.bus.send(event);
              loggerSub.debug(`--- ...done running callback`);
            }
          }
          // let all the other kinds of events through
        } else if (event.kind === "failure") {
          loggerSub.debug(`--- ingest failure event`);
          await this.bus.send(event);
        } else if (event.kind === "nothing_happened") {
          loggerSub.debug(`--- nothing happened event`);
          await this.bus.send(event);
        } else {
          loggerSub.debug(`--- WARNING: unknown event type event`);
          console.warn("this should never happen:", event);
          console.warn(
            "this should never happen: unrecognised kind of LiveQueryEvent: " +
              event.kind,
          );
        }
      },
    );
  }

  /** Permanently shut down the QueryFollower, unhooking from the storage and stopping the processing of events. */
  // Triggered when the storage closes
  // Can also be called manually if you just want to destroy this queryFollower.
  async close(): Promise<void> {
    if (this._state === "closed") return;
    logger.debug("close...");

    this._state = "closed";
    if (this._unsub) this._unsub;

    let event: QueryFollowerDidClose = { kind: "queryFollowerDidClose" };
    await this.bus.send(event);

    logger.debug("...close is done.");

    return Promise.resolve();
  }
}
