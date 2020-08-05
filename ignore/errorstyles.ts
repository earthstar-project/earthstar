
//================================================================================
// SETUP

type Dog = {
    name : string,
    age : number,
}
type Err = {
    err : string,
}
let isErr = <T>(x : T | Err) : x is Err =>
    'err' in x;
let notErr = <T>(x : T | Err) : x is T =>
    !isErr(x);


type Result<T> = T | Error;
let isError = <T>(result : Result<T>) : result is Error =>
    result instanceof Error;
let isSuccess = <T>(result : Result<T>) : result is T =>
    !isError(result);

let log = console.log;


//================================================================================
// DIFFERENT STYLES OF HANDLING ERRORS

// Custom error style
// Our Err type is {err: string}
let makeDogA = (name : string) : Dog | Err => {
    if (name === '') { return {err: 'nope'}; }
    return { name: name, age: 5 };
}
let dogA = makeDogA('');
log(dogA.age);  // good, error as expected
if ('err' in dogA) {
    log(dogA.err);  // good
} else {
    log(dogA.age);  // good
}

// Result<T> style
// Result<T> is the same as T | Error
// This uses the built-in node Error type.
let makeDogB = (name : string) : Dog | Error => {
    if (name === '') { return new Error('nope'); }
    return { name: name, age: 5 };
}
let dogB = makeDogB('');
log(dogB.name);  // :( Error fields "name", "message", and "stack" collide with Dog fields
                 //    allowing an accidentally successful line of code here, which should be an error
log(dogB.age);  // at least this one is an error, good
if (dogB instanceof Error) {
    log(dogB.message);  // good
} else {
    log(dogB.age);  // good
}

// node style
// Return either ["error details", null] or [null, successfulObject]
//
let makeDogC = (name : string) : [string | null, Dog | null] => {
    if (name === '') { return ["nope", null]; }
    return [null, { name: name, age: 5 }];
}
let [errC, dogC] = makeDogC('');
log(dogC.name);  // good, error as expected
if (dogC) {
    log(dogC.name);  // good
} else {
    log(errC);  // good, can get error message
}
if (!errC) {
    log(dogC.name);  // checking !err is not enough to satisfy Typescript, have to check dog directly
} else {
    log(errC);  // good, can get error message
}

// Classic throw/catch
// The fatal flaw of this one is Typescript doesn't track which exceptions
// can be thrown by a function, so you don't know when to use try/catch.
let makeDogD = (name : string) : Dog => {  // this looks safe to me...
    if (name === '') { throw new Error('nope'); }
    return { name: name, age: 5 };
}
let dogD = makeDogD('');
log(dogD.name);  // :( no compile error, you have to remember this function can throw, and catch errors yourself
// if you remember to do a try/catch:, it takes up a lot of space:
try {
    let dogD2 = makeDogD('');
    log(dogD2.name);  // good, no type danger here
} catch (err2) {
    log(err2);  // good, can get error message
}
