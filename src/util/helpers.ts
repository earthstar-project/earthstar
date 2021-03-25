export let isPlainObject = (obj : any) : obj is object =>
    // Check if the input is a plain object type { ... }
    // Exclude arrays, undefined, etc.
    // For now class instances count as plain objects (is this a bug?)
    Object.prototype.toString.call(obj) === '[object Object]'

export let range = (n : number) : number[] =>
    // Make an array of n consecutive integers starting with zero.
    //   range(n) --> [0, 1, ... n-1]
    [...Array(n).keys()]

export let stringMult = (str : string, n : number) : string =>
    // Repeat a string a given number of times.
    //   stringMult('a!', 3) --> 'a!a!a!'
    range(n).map(x => str).join('')

export let sleep = async (ms : number) : Promise<void> =>
    // Return a promise that resolves after a given number of millisceconds
    new Promise((resolve, reject) => setTimeout(resolve, ms) );

export let uniq = (items: string[]) : string[] => {
    // Given an array of strings,
    // return a new array of unique strings
    // (in the same order as the first occurrance of
    // each string).
    let map : Record<string, boolean> = {};
    for (let item of items) {
        map[item] = true;
    }
    return Object.keys(map);
}

export let sorted = <T>(items: T[]) : T[] => {
    // Sort an array, mutating it in place,
    // and return it.
    items.sort();
    return items;
}

export let objWithoutUndefined = <T extends Record<string, any>>(obj: T): T => {
    // Given an object, return a copy of the object
    // which omits any undefined keys.
    // Does not mutate the original object.
    // Example:
    //   objWithoutUndefined({ a:1, b: undefined }) --> { a:1 }
    let obj2: any = {};
    for (let [key, val] of Object.entries(obj)) {
        if (val !== undefined) {
            obj2[key] = val;
        }
    }
    return obj2 as T;
}

// replace all occurrences of substring "from" with "to"
export let replaceAll = (str: string, from: string, to: string): string => {
    return str.split(from).join(to);
};

// how many times does the character occur in the string?
export let countChars = (str: string, char: string) => {
    if (char.length != 1) { throw new Error('char must have length 1 but is ' + JSON.stringify(char)); }
    return str.split(char).length - 1;
};
