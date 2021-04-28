import {
    Cmp
} from './util-types';
import {
    deepEqual
} from '../util/misc';

//================================================================================

// myArray.sort(baseCompare)
export let compareBasic = (a: any, b: any): Cmp => {
    if (deepEqual(a, b)) { return Cmp.EQ; }
    return (a < b) ? Cmp.LT : Cmp.GT;
}

// myArray.sort(arrayCompare)
export let compareArrays = (a: any[], b: any[]): Cmp => {
    let minLen = Math.min(a.length, b.length);
    for (let ii = 0; ii < minLen; ii++) {
        let elemCmp = compareBasic(a[ii], b[ii]);
        if (elemCmp !== Cmp.EQ) { return elemCmp; }
    }
    return compareBasic(a.length, b.length);
}

// myArray.sort(compareByObjKey('signature'));
export let compareByObjKey = (key: string) =>
    (a: Record<string, any>, b: Record<string, any>): Cmp =>
        compareBasic(a[key], b[key]);

// myArray.sort(compareByFn((x) => x.signature + x.path));
export let compareByFn = (fn: (x: any) => any) =>
    (a: Record<string, any>, b: Record<string, any>): Cmp =>
        compareBasic(fn(a), fn(b));

// myArray.sort(compareByObjArrayFn((x) => [x.signature, x.path]));
export let compareByObjArrayFn = (fn: (x: any) => any[]) =>
    (a: Record<string, any>, b: Record<string, any>): Cmp =>
        compareArrays(fn(a), fn(b));
