export class Lock {
    _locked : boolean = false;
    _waiting : any = [];  // the resolve methods for waiting promises
    async get() : Promise<void> {
        if (!this._locked) {
            this._locked = true;
            return;
        } else {
            let p = new Promise<void>((resolve, reject) => {
                this._waiting.push(resolve);
            });
            return p;
        }
    }
    release() : void {
        this._locked = false;
        if (this._waiting.length) {
            let next = this._waiting.shift();
            next();
        }
    }
    async whenFree<R>(cb : () => Promise<R>) : Promise<R> {
        // run the provided async callback when the lock is free
        await this.get();
        let result : R = await cb();
        this.release();
        return result;
    }
    lockify<P extends Array<any>, R>(fn : (...args : P) => Promise<R>) : ((...args : P) => Promise<R>) {
        // wrap a function in the lock so it will only run one at a time
        // the input function should be async
        return async (...args : P) : Promise<R> => {
            await this.get();
            let result : R = await fn(...args);
            this.release();
            return result;
        }
    }
}