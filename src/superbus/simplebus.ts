import { Lock } from "../concurrency_friends/lock.ts";

export type SimplebusCallback<T> = (data: T) => void | Promise<void>;

export class Simplebus<T> {
  _cbs: Set<SimplebusCallback<T>>;
  _cbsOnce: Set<SimplebusCallback<T>>;
  _lock: Lock<void>;
  constructor() {
    this._cbs = new Set<SimplebusCallback<T>>();
    this._cbsOnce = new Set<SimplebusCallback<T>>();
    this._lock = new Lock<void>();
  }
  async send(data: T, opts?: { useLock: boolean }): Promise<void> {
    // useLock: default true
    // To avoid deadlock, set useLock: false when you send from
    // inside another event handler (on the same Simplebus instance)
    let useLock = opts === undefined ? true : opts.useLock;
    await this._lock.run(async () => {
      for (let cb of this._cbs) {
        await cb(data);
      }
      for (let cb of this._cbsOnce) {
        await cb(data);
      }
      this._cbsOnce.clear();
    }, { bypass: !useLock });
  }
  on(cb: SimplebusCallback<T>): () => void {
    this._cbs.add(cb);
    return () => this._cbs.delete(cb);
  }
  once(cb: SimplebusCallback<T>): () => void {
    this._cbsOnce.add(cb);
    return () => this._cbsOnce.delete(cb);
  }
  removeAllSubscribers() {
    this._cbs.clear();
    this._cbsOnce.clear();
  }
}
