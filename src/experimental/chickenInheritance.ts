import { sleep } from "../util/misc";

// This is the async setup we need to do for each of our chickens
let makeChickenName = async (): Promise<string> => {
    await sleep(1000);
    return "chickie";
};

//--------------------------------------------------

enum LifecycleCh {
    // a linear sequence of states for the state machine
    NEW = 0,
    HATCHING = 1, // temporary, while hatch() is in progress
    READY = 2,
    CLOSING = 3, // temporary, while close() is in progress
    CLOSED = 4,
    // once CLOSED there's no going back
}

interface HatchableCh {
    hatch(): Promise<void>;
    isReady(): boolean;
    ready: Promise<void>; // is resolved when lifecycle is READY, rejects otherwise
}
interface ClosableCh {
    close(): Promise<void>;
    isClosed(): boolean;
}

class BasicChickenWithLifecycle implements HatchableCh, ClosableCh {
    lifecycle: LifecycleCh = LifecycleCh.NEW;

    ready: Promise<void>;
    _resolve: () => void;
    _reject: () => void;

    constructor() {
        this._resolve = () => {};
        this._reject = () => {};
        this.ready = new Promise<void>((resolve, reject) => {
            this._resolve = resolve;
            this._reject = reject;
        });
    }

    //----------------------------------------
    // LIFECYCLE MANAGEMENT
    async hatch() {
        if (this.lifecycle !== LifecycleCh.NEW) return; // hatching twice does nothing

        this.lifecycle = LifecycleCh.HATCHING;
        await this.onHatch();
        this.lifecycle = LifecycleCh.READY;

        // release anyone waiting on our this.ready promise
        this._resolve();
    }
    async onHatch() {} // override me
    async close() {
        // closing twice does nothing
        // TODO: can you close something that's NEW or HATCHING?
        if (this.lifecycle !== LifecycleCh.READY) return;

        // make a new promise that is always rejected
        this.ready = Promise.reject();
        // and release anyone waiting on the old this.ready promise
        this._reject();

        this.lifecycle = LifecycleCh.CLOSING;
        await this.onClose();
        this.lifecycle = LifecycleCh.CLOSED;
    }
    async onClose() {} // override me

    isReady() {
        return this.lifecycle === LifecycleCh.READY;
    }
    isClosed() {
        return this.lifecycle === LifecycleCh.CLOSED;
    }
    isSortofReady() {
        // some of our functions might also need to run
        // during the HATCHING or CLOSING phases...
        return this.lifecycle !== LifecycleCh.NEW &&
            this.lifecycle !== LifecycleCh.CLOSED;
    }
    _throwIfNotReady() {
        if (!this.isReady()) {
            throw new Error(`lifecycle is ${this.lifecycle} instead of READY`);
        }
    }
    _throwIfNotSortofReady() {
        if (!this.isSortofReady()) {
            throw new Error(
                `lifecycle is ${this.lifecycle} but must be HATCHING, READY, or CLOSING.`,
            );
        }
    }
}

//--------------------------------------------------

class ActualChicken extends BasicChickenWithLifecycle {
    name: string | undefined;
    numEggs: number;
    constructor(numEggs: number) {
        super();
        this.numEggs = numEggs;
    }

    async onHatch(): Promise<void> {
        this.name = await makeChickenName();
    }

    async squawkAsync() {
        await this.ready;
        console.log(this.name);
    }
    squawkSync() {
        this._throwIfNotReady();
        console.log(this.name);
    }
}

//--------------------------------------------------

let main = async () => {
    let myChickie = new ActualChicken(123);
    // you have to remember to call hatch and await it.
    await myChickie.hatch();

    await myChickie.squawkAsync();
    myChickie.squawkSync();

    await myChickie.close();

    // this will wait until the chicken is READY
    // or it will reject if the chicken is CLOSING or CLOSED
    //   await myChickie.ready;
};
