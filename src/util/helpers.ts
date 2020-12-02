export let isPlainObject = (obj : any) : obj is object =>
    Object.prototype.toString.call(obj) === '[object Object]'

export let range = (n : number) : number[] =>
    // [0, 1, ... n-1]
    [...Array(n).keys()]

// stringMult('a!', 3) === 'a!a!a!'
export let stringMult = (str : string, n : number) : string =>
    range(n).map(x => str).join('')

export let sleep = async (ms : number) : Promise<void> =>
    new Promise((resolve, reject) => setTimeout(resolve, ms) );

export let uniq = (items: string[]) : string[] => {
    let map : Record<string, boolean> = {};
    for (let item of items) {
        map[item] = true;
    }
    return Object.keys(map);
}
export let sorted = <T>(items: T[]) : T[] => {
    items.sort();
    return items;
}
