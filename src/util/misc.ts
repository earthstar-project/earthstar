import {
    Cmp
} from '../types/util-types';

import equal from 'fast-deep-equal';
import clone from 'rfdc';

export let deepEqual = equal;
export let deepCopy = clone();

//================================================================================
// TIME

export let microsecondNow = () =>
    Date.now() * 1000;

export let sleep = (ms: number) =>
    new Promise((res, rej) => {
        setTimeout(res, ms);
    });

//================================================================================
// MISC 

export let getPromiseParts = <T>() => {
    // make a promise, extract the res and rej methods, and return all three.
    let resolve: (value: T | PromiseLike<T>) => void = null as any;
    let reject: (reason?: any) => void = null as any;
    let prom = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { prom, resolve, reject };
}
