import {
    Cmp
} from './util-types';

//================================================================================

export let baseCompare = (a: any, b: any): Cmp => {
    if (a === b) { return Cmp.EQ; }
    return (a < b) ? Cmp.LT : Cmp.GT;
}

export let arrayCompare = (a: any[], b: any[]): Cmp => {
    let minLen = Math.min(a.length, b.length);
    for (let ii = 0; ii < minLen; ii++) {
        let elemCmp = baseCompare(a[ii], b[ii]);
        if (elemCmp !== Cmp.EQ) { return elemCmp; }
    }
    return baseCompare(a.length, b.length);
}

export let keyComparer = (key: string) =>
    (a: Record<string, any>, b: Record<string, any>): Cmp =>
        baseCompare(a[key], b[key]);

export let fnComparer = (fn: (x: any) => any) =>
    (a: Record<string, any>, b: Record<string, any>): Cmp =>
        baseCompare(fn(a), fn(b));

export let arrayComparer = (fn: (x: any) => any[]) =>
    (a: Record<string, any>, b: Record<string, any>): Cmp =>
        arrayCompare(fn(a), fn(b));

// myArray.sort(keyComparer('signature'));
// myArray.sort(fnComparer((x) => x.signature + x.path));
// myArray.sort(arrayComparer((x) => [x.signature, x.path]));