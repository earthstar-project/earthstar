
// microseconds, not milliseconds

let prev = Date.now() * 1000;
export let monotonicNow = () : number => {
    let result = Math.max(Date.now() * 1000, prev+1);
    prev = result;
    return result;
}


