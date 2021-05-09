import { sleep } from '../util/misc';

/*
    Experiments in lifecycle management for classes.

    What happens when you need to do some async setup for your class,
    but a constructor can't be an async function?

    We use an async hatch() function to do this setup / initialization,
    but the user has to remember to call it, and remember to await it.

    Also how does this integrate with an object that can close()?

    Here are some ways to do it:
*/


// This is the async setup we need to do for each of our chickens
let makeChickenName = async (): Promise<string> => {
    await sleep(1000);
    return 'chickie';
}

//--------------------------------------------------
// VERSION 1
//
// hatch()
// - user is expected to call "await hatch()" before using the object
// - track lifecycle using isHatched boolean
// - throw an error if you use it before hatching

class Chicken1 {
    name: string | undefined;  // it's annoying that this can be undefined
    numEggs: number;
    isHatched: boolean = false;
    constructor(numEggs: number) {
        this.numEggs = numEggs;
    }
    async hatch() {
        if (this.isHatched) { return; }  // hatching twice does nothing
        this.name = await makeChickenName();
        this.isHatched = true;
    }
    squawk() {
        if (!this.isHatched) { throw new Error('not hatched yet'); }
        console.log(this.name);
    }
}

let main1 = async () => {
    let myChickie = new Chicken1(123);
    await myChickie.hatch();  // don't forget this!
    myChickie.squawk();       // or this will throw an error
}

//--------------------------------------------------
// VERSION 2
//
// a factory function which calls hatch for you
// so you can't forget it

let makeChicken2 = async (numEggs: number): Promise<Chicken1> => {
    // downside is: we have to repeat the constructor parameters
    // in two places: the original constructor, and this factor function
    let chicken = new Chicken1(numEggs);
    await chicken.hatch();
    return chicken;
}

let main2 = async () => {
    let myChickie = await makeChicken2(123);
    myChickie.squawk();
}

//--------------------------------------------------
// VERSION 3
//
// a promise to track if we're hatched

class Chicken3 {
    name: string | undefined;
    numEggs: number;
    isHatched: boolean = false;;
    hatched: Promise<void>;  // promise that resolves when hatched
    _resolve: () => void;
    constructor(numEggs: number) {
        this.numEggs = numEggs;

        this._resolve = () => {};
        this.hatched = new Promise<void>((resolve, reject) => {
            this._resolve = resolve;
        });
    }
    async hatch() {
        if (this.isHatched) { return; }  // hatching twice does nothing
        this.name = await makeChickenName();
        this._resolve();
        this.isHatched = true;
    }
    async squawkAsync() {
        // we can make all our methods block until hatch is called
        // but then all our methods have to be async
        await this.hatched;
        console.log(this.name);
    }
    squawkSync() {
        // or we can keep using the boolean isHatched and just
        // throw errors if not hatched
        if (!this.isHatched) { throw new Error('not hatched yet'); }
        console.log(this.name);
    }
}

let main3 = async () => {
    let myChickie = new Chicken3(123);
    // you have to remember to call hatch and await it.
    await myChickie.hatch();

    // it's sort of optional to wait until the chicken is hatched...
    await myChickie.hatched;

    // because this method also waits for you
    await myChickie.squawkAsync();
    // but this one will throw an error if not hatched
    myChickie.squawkSync();
}

//--------------------------------------------------
// VERSION 4
//
// tracking entire lifecycle including closing it
// - we also track the in-between states HATCHING and CLOSING
//    because we can be in that state for a while
//    and we need finer control over what is allowed
//    to happen during that process
// - we also offer a ready promise that waits until we reach READY
//    and rejects when we're CLOSING or CLOSED.
//    It's important for it to reject or someone might get stuck
//    waiting on it forever
// - this is a lot of boilerplate for every class to have

enum LifecycleCh {
    // a linear sequence of states for the state machine
    NEW = 0,
    HATCHING = 1,  // temporary, while hatch() is in progress
    READY = 2,
    CLOSING = 3,   // temporary, while close() is in progress
    CLOSED = 4,
                   // once CLOSED there's no going back
}

interface HatchableCh {
    hatch(): Promise<void>;
    isReady(): boolean;
    ready: Promise<void>;  // is resolved when lifecycle is READY, rejects otherwise
}
interface ClosableCh {
    close(): Promise<void>;
    isClosed(): boolean;
}

class Chicken4 implements HatchableCh, ClosableCh {
    name: string | undefined;
    numEggs: number;
    lifecycle: LifecycleCh = LifecycleCh.NEW;

    ready: Promise<void>;
    _resolve: () => void;
    _reject: () => void;

    constructor(numEggs: number) {
        this.numEggs = numEggs;

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
        if (this.lifecycle !== LifecycleCh.NEW) { return; }  // hatching twice does nothing

        this.lifecycle = LifecycleCh.HATCHING;
        this.name = await makeChickenName();
        this.lifecycle = LifecycleCh.READY;

        // release anyone waiting on our this.ready promise
        this._resolve();
    }
    async close() {
        // closing twice does nothing
        // TODO: can you close something that's NEW or HATCHING?
        if (this.lifecycle !== LifecycleCh.READY) { return; }

        // make a new promise that is always rejected
        this.ready = Promise.reject();
        // and release anyone waiting on the old this.ready promise
        this._reject();

        this.lifecycle = LifecycleCh.CLOSING;
        // do some async stuff here related to closing
        // await cleanUpAfterChicken()
        this.lifecycle = LifecycleCh.CLOSED;
    }

    isReady() { return this.lifecycle === LifecycleCh.READY; }
    isClosed() { return this.lifecycle === LifecycleCh.CLOSED; }
    isSortofReady() {
        // some of our functions might also need to run
        // during the HATCHING or CLOSING phases...
        return this.lifecycle !== LifecycleCh.NEW && this.lifecycle !== LifecycleCh.CLOSED;
    }
    _throwIfNotReady() {
        if (!this.isReady()) { throw new Error(`lifecycle is ${this.lifecycle} instead of READY`); }
    }
    _throwIfNotSortofReady() {
        if (!this.isSortofReady()) { throw new Error(`lifecycle is ${this.lifecycle} but must be HATCHING, READY, or CLOSING.`); }
    }

    //----------------------------------------
    // ACTUAL CODE
    async squawkAsync() {
        await this.ready;
        console.log(this.name);
    }
    squawkSync() {
        this._throwIfNotReady();
        console.log(this.name);
    }
}

let main4 = async () => {
    let myChickie = new Chicken4(123);
    // you have to remember to call hatch and await it.
    await myChickie.hatch();

    await myChickie.squawkAsync();
    myChickie.squawkSync();

    await myChickie.close();

    // this will wait until the chicken is READY
    // or it will reject if the chicken is CLOSING or CLOSED
    //   await myChickie.ready;
}
