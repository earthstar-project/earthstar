/*

A queue of items which are consumed by a single provided handler function,
one item at a time.

Users put items into the queue.  They are run one at a time through the handler,
using `await cb(x)` to make sure only one copy of the handler function runs at a time.
The handler can be an async function (returning a promise) or a sync function.

If you await conveyor.push(x), you will continue after the handler has finished
running on x.  The await will return the return value of the handler function.

It's many-to-one:
Anyone can put items in (fan-in), but only one function processes the data (no fan-out).

Pushing items into the queue is an instant synchronous operation which never blocks.
When pushed, and item won't be processed until queueMicrotask runs, or later.

The queue length is unlimited.

You can provide a priority as a second parameter to push, like conveyor.push(item, 7).

Lower priorities will run first.

Items without a priority are auto-assigned a priority that keeps incrementing behind
the scenes, making it possible to mix prioritied items with non-prioritied items.

The auto-priorities start at 1000 and increase with each push.

*/

import { Heap } from "../../deps.ts";

import { Deferred, makeDeferred } from "./deferred.ts";

// T: type of the items in the queue (input of the handler function)
// R: return type of the handler function

export type ConveyorHandlerFn<T, R> = (item: T) => R | Promise<R>;
type QueueItem<T, R> = {
    item: T;
    deferred: Deferred<R>;
    priority: number | string;
};

export class Conveyor<T, R> {
    _queue: Heap<QueueItem<T, R>>;
    _threadIsRunning: boolean = false;
    _handlerFn: ConveyorHandlerFn<T, R>;
    _ii: number = 1000;

    constructor(handler: ConveyorHandlerFn<T, R>) {
        // Create a new Conveyor with a sync or async handler function.

        this._handlerFn = handler;
        this._queue = new Heap<QueueItem<T, R>>(
            (a: QueueItem<T, R>, b: QueueItem<T, R>) => {
                if (a.priority < b.priority) return -1;
                if (a.priority > b.priority) return 1;
                return 0;
            },
        );
    }

    async push(item: T, priority?: number | string): Promise<R> {
        // Add an item into the conveyor.
        // After the handler finishes running on this item,
        // this promise will resolve with the return value of the handler,
        // or with an exception thrown by the handler.

        // If priority is provided, it will control the order in which
        // items are handled (if many are waiting).  Lower priorities run
        // first.  Items not given an explicit priority are given an auto-incrementing
        // priority starting at 1000.

        // push item into the queue
        let deferred = makeDeferred<R>(); // this will resolve when the item is done being handled
        this._queue.push({ item, deferred, priority: priority ?? this._ii });
        if (priority === undefined) {
            this._ii += 1;
        }

        // wake up the thread
        queueMicrotask(this._thread.bind(this));

        return deferred.promise;
    }

    async _thread(): Promise<void> {
        // don't run a second copy of the thread
        if (this._threadIsRunning) return;
        this._threadIsRunning = true;

        while (true) {
            // process next item in queue.
            //let nextItem = this._queue.dequeue();
            let nextItem: QueueItem<T, R> | undefined;
            nextItem = this._queue.pop();
            if (nextItem === undefined) {
                // queue is empty; stop thread
                this._threadIsRunning = false;
                return;
            }
            // else, queue is not empty
            let { item, deferred, priority } = nextItem;
            try {
                // run the handler function on the item...
                let result = this._handlerFn(item);
                if (result instanceof Promise) {
                    result = await result;
                }
                // then resolve or reject the promise for whoever added this item to the queue
                deferred.resolve(result);
            } catch (err) {
                deferred.reject(err);
            }
        }
    }
}

// TODO: allow the handler to return false to close the conveyor?
// TODO: add close() and closed?
// TODO: send a special parameter to the handler when the queue becomes idle, maybe undefined?
// TODO: rebuild on top of Chan?
