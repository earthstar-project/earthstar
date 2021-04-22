import { sleep } from '../util/misc';

export class Lock {
    // TODO: only allow one call to do() to run at once.
    // other calls should block until they get a chance to run.
    async run<T>(cb: () => Promise<T>): Promise<T> {
        await sleep(100);
        return await cb();
    }
}
