import equal from 'fast-deep-equal';
import clone from 'rfdc';

export let deepEqual = equal;
export let deepCopy = clone();

//================================================================================

export let log = console.log;

export let sleep = (ms: number) => {
    return new Promise((res, rej) => {
        setTimeout(res, ms);
    });
}

export let remap = (x: number, oldLo: number, oldHi: number, newLo: number, newHi: number ): number => {
    let pct = (x - oldLo) / (oldHi - oldLo);
    return newLo + (newHi - newLo) * pct;
}

export let randRange = (lo: number, hi: number): number =>
    remap(Math.random(), 0, 1, lo, hi);

export let uuid = () =>
    ('' + randRange(0, 999999999999999)).padStart(15, '0');

export let hash = (s: string) => {
    return 'fakehash' + uuid();
}

//================================================================================

export enum Cmp {
    // this sorts ascendingly
    LT = -1,
    EQ = 0,
    GT = 1,
}
export type CmpResult = '<' | '===' | '>';
export let compare = (a: any, b: any): Cmp => {
    if (a === b) { return Cmp.EQ; }
    return (a < b) ? Cmp.LT : Cmp.GT;
}
export let arrayCompare = (a: any[], b: any[]): Cmp => {
    let minLen = Math.min(a.length, b.length);
    for (let ii = 0; ii < minLen; ii++) {
        let elemCmp = compare(a[ii], b[ii]);
        if (elemCmp !== Cmp.EQ) { return elemCmp; }
    }
    return compare(a.length, b.length);
}
export let keyComparer = (key: string) =>
    (a: Record<string, any>, b: Record<string, any>): Cmp =>
        compare(a[key], b[key]);
export let fnComparer = (fn: (x: any) => any) =>
    (a: Record<string, any>, b: Record<string, any>): Cmp =>
        compare(fn(a), fn(b));
export let arrayComparer = (fn: (x: any) => any[]) =>
    (a: Record<string, any>, b: Record<string, any>): Cmp =>
        arrayCompare(fn(a), fn(b));

// myArray.sort(keyComparer('signature'));
// myArray.sort(fnComparer((x) => x.signature + x.path));
// myArray.sort(arrayComparer((x) => [x.signature, x.path]));
