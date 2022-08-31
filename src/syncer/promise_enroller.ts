import { EarthstarError } from "../util/errors.ts";
import { MultiDeferred } from "./multi_deferred.ts";

export class PromiseEnroller<ReturnType> {
  private promises = new Set<Promise<ReturnType>>();
  private sealed = false;
  private multiDeferred = new MultiDeferred();
  private allowRejectedPromises: boolean;

  constructor(allowRejectedPromises: boolean = false) {
    this.allowRejectedPromises = allowRejectedPromises;
  }

  enrol(promise: Promise<ReturnType>) {
    if (this.sealed) {
      throw new EarthstarError(
        "Tried to enrol a promise when enrolment was already sealed.",
      );
    }

    this.promises.add(promise);

    promise.then(() => {
      this.checkAllDone();
    });
  }

  checkAllDone() {
    if (!this.sealed) {
      return;
    }

    if (this.allowRejectedPromises) {
      Promise.allSettled(this.promises).then(() => {
        this.multiDeferred.resolve();
      });
    } else {
      Promise.all(this.promises).then(() => {
        this.multiDeferred.resolve();
      }).catch(() => {
        this.multiDeferred.reject();
      });
    }
  }

  seal() {
    if (this.sealed) {
      return;
    }

    this.sealed = true;

    this.checkAllDone();
  }

  isSealed() {
    return this.sealed;
  }

  isDone() {
    const promise = this.multiDeferred.getPromise();

    return promise;
  }
}
