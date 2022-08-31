import {
  Deferred,
  deferred,
} from "https://deno.land/std@0.150.0/async/deferred.ts";

export class MultiDeferred<ReturnType> {
  private deferreds = new Set<Deferred<ReturnType>>();
  state: Deferred<void>["state"] = "pending";

  resolve(value?: ReturnType) {
    if (this.state !== "pending") {
      return;
    }

    this.state = "fulfilled";

    for (const deferred of this.deferreds) {
      deferred.resolve(value);
    }
  }

  reject(reason?: any) {
    if (this.state !== "pending") {
      return;
    }

    this.state = "rejected";

    for (const deferred of this.deferreds) {
      deferred.reject(reason);
    }
  }

  getPromise() {
    if (this.state === "fulfilled") {
      return Promise.resolve();
    } else if (this.state === "rejected") {
      return Promise.reject();
    }

    const promise = deferred<ReturnType>();
    this.deferreds.add(promise);
    return promise;
  }
}
