export let isPlainObject = (obj : any) : obj is object =>
    Object.prototype.toString.call(obj) === '[object Object]'

export let range = (n : number) : number[] =>
    // [0, 1, ... n-1]
    [...Array(n).keys()]

// stringMult('a!', 3) === 'a!a!a!'
export let stringMult = (str : string, n : number) : string =>
    range(n).map(x => str).join('')

export let sleep = async (ms : number) : Promise<void> => {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, ms);
    });
}
