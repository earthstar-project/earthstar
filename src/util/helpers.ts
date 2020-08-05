export let isPlainObject = (obj : any) : obj is object =>
    Object.prototype.toString.call(obj) === '[object Object]'
