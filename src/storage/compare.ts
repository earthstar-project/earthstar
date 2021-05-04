import {
    Cmp
} from './util-types';
import {
    deepEqual
} from '../util/misc';

//================================================================================

export type SortOrder = 'ASC' | 'DESC';

export let sortedInPlace = <T>(array: T[]): T[] => {
    array.sort();
    return array;
}

// myStrings.sort(baseCompare)
export let compareBasic = (a: any, b: any, order: SortOrder = 'ASC'): Cmp => {
    if (deepEqual(a, b)) { return Cmp.EQ; }
    if (order === 'ASC' || order === undefined) {
        return (a < b) ? Cmp.LT : Cmp.GT;
    } else if (order === 'DESC') {
        return (a > b) ? Cmp.LT : Cmp.GT;
    } else {
        throw new Error('unexpected sort order to compareBasic: ' + JSON.stringify(order));
    }
}

/**
 * example usage: myArrayOfArrays.sort(arrayCompare)
 * 
 * Compare arrays element by element, stopping and returning the first non-EQ comparison.
 * Earlier array items are more important.
 * When arrays are different lengths and share the same prefix, the shorter one
 * is less than the longer one.  In other words, the undefined you would get by
 * reading of the end of the array counts as lower than any other value.
 * 
 * For example, this list of arrays is sorted:
 *   - [1],
 *   - [1, 1],
 *   - [1, 1, 99],
 *   - [1, 2],
 *   - [1, 2],
 *   - [2],
 *   - [2, 99],
 *   - [2, 99, 1],
 * 
 * sortOrders is an array of 'ASC' | 'DESC' strings.  Imagine it's applied
 * to the columns of a spreadsheet.
 * 
 * For example, to sort DESC by the first item, and ASC by the second item:
 *  compareArrays(['hello', 123], ['goodbye', 456], ['DESC', 'ASC']).
 * 
 * Sort order defaults to 'ASC' when the sortOrders array is not provided.
 * If the sortOrders array is shorter than the arrays to be sorted, it acts
 *  as if it was filled out with additional 'ASC' entries as needed.
 * A sort order of 'DESC' in the appropriate column can make longer arrays
 *  come before shorter arrays.
 * 
 *  sortOrders ['ASC', 'DESC'] sorts in this order:
 *  - [1, 99],
 *  - [1, 2],
 *  - [1],  // shorter array comes last, because of DESC in this column
 *  - [2],  // but first element is still sorted ASC
 */
export let compareArrays = (a: any[], b: any[], sortOrders?: SortOrder[]): Cmp => {
    let minLen = Math.min(a.length, b.length);
    for (let ii = 0; ii < minLen; ii++) {
        let sortOrder = sortOrders?.[ii] ?? 'ASC';  // default to ASC if sortOrders is undefined or too short
        let elemCmp = compareBasic(a[ii], b[ii], sortOrder);
        if (elemCmp !== Cmp.EQ) { return elemCmp; }
    }
    // arrays are the same length, and all elements are the same
    if (a.length === b.length) { return Cmp.EQ; }

    // arrays are not the same length.
    // use the sort order for one past the end of the shorter array,
    // and apply it to the lengths of the array (so that DESC makes the
    // shorter one come first).
    let ii = Math.min(a.length, b.length);
    let sortOrder = sortOrders?.[ii] ?? 'ASC';  // default to ASC if sortOrders is undefined or too short
    return compareBasic(a.length, b.length, sortOrder);
}

// myArray.sort(compareByObjKey('signature', 'ASC'));
export let compareByObjKey = (key: string, sortOrder: SortOrder = 'ASC') =>
    (a: Record<string, any>, b: Record<string, any>): Cmp =>
        compareBasic(a[key], b[key], sortOrder);

// myArray.sort(compareByFn((x) => x.signature + x.path));
export let compareByFn = (fn: (x: any) => any) =>
    (a: Record<string, any>, b: Record<string, any>): Cmp =>
        compareBasic(fn(a), fn(b));

// myArray.sort(compareByObjArrayFn((x) => [x.signature, x.path]));
export let compareByObjArrayFn = (fn: (x: any) => any[]) =>
    (a: Record<string, any>, b: Record<string, any>): Cmp =>
        compareArrays(fn(a), fn(b));
