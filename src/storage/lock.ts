import { sleep } from '../util/misc';

export class Lock {
    // TODO: only allow one call to run() to run at once.
    // other calls should block until they get a chance to run.
    async run<T>(cb: () => Promise<T>): Promise<T> {
        await sleep(1);
        return await cb();
    }
}
