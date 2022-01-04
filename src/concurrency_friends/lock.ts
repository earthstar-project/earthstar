/*
A lock is a way to only allow one function to run at a time
First, create your lock:
    let lock = new Lock<R>();
R is the return type of the functions you'll feed it.
Now you can feed it functions to run (sync or async).
It will run them one at a time in the same order that lock.run is called,
waiting for each one to finish before moving on to the next one.
It keeps an internal queue of functions waiting for their turn to run.
    lock.run(async () => {
        // do some things
        await foo();
        await bar();
    });
    lock.run(async () => {
        // do more things
        // this function won't begin until the previous one is finished
        // even though in this case we didn't await the lock.run call
        await baz();
    });
    lock.run(() => {
        // synchronous functions also work
        console.log('hello')
    });
You can await lock.run to wait until your specific function is done running,
and you'll get back the return value of your function:
    let val = await lock.run(async () => {
        // do some things
        return 123;
    });
    // things are now done
    // val is 123
Note that functions provided to lock.run won't be started until the next microtask.
*/

import { Conveyor } from "./conveyor.ts";
import { makeDeferred } from "./deferred.ts";

// R: the return type of any function that can go into the lock

type FnToRun<R> = () => R | Promise<R>;
interface LockOpts {
  priority?: number | string;
  bypass?: boolean;
}

export class Lock<R> {
  _conveyor: Conveyor<FnToRun<R>, R>;
  constructor() {
    // A conveyor full of functions, to run one at a time.
    // At the end of the conveyor, this handler just runs the functions.
    let handlerFn = async (fnToRun: FnToRun<R>) => {
      let result = fnToRun();
      if (result instanceof Promise) result = await result;
      return result;
    };
    this._conveyor = new Conveyor<FnToRun<R>, R>(handlerFn);
  }
  async run(fnToRun: FnToRun<R>, opts?: LockOpts): Promise<R> {
    // priority defaults to undefined
    let priority: number | string | undefined = opts === undefined
      ? undefined
      : opts.priority;
    // bypass defaults to false
    let bypass: boolean = opts === undefined ? false : (opts.bypass === true);
    if (bypass) {
      let d = makeDeferred<R>();
      queueMicrotask(async () => {
        try {
          d.resolve(await fnToRun());
        } catch (err) {
          d.reject(err);
        }
      });
      return d.promise;
    } else {
      // This will resolve when the fnToRun has finished running.
      return await this._conveyor.push(fnToRun, priority);
    }
  }
}
