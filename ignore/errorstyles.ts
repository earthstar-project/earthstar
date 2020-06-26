
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


/*
                no null ref                     overall
                        easy check for err
                                err check does type guarding
                                        can get err message

Dog|Err         good    fn      good    good    weird err check, simple types, shadowing of 'err' field

Dog|Error       shadow  fn      good    good    weird err check, simple types, shadowing of fields from Error (type, message, stack)  this is Result<T>

[Err | null,    good    good    oneway  good    ok if used correctly, not as wordy
 Dog | null]

---------------

{dog?, err?}    good    good    oneway  good    ok if used correctly, wordy

{dog | null,    good    good    oneway  good    ok if used correctly, wordy
 err | null}

throw           no err  long    good    good    err is not captured in type info (easy to forget).  easy to chain though.

Dog|null        good    good    good    no      nice and simple but no error info

*/







// https://spin.atomicobject.com/2018/02/23/error-either-typescript/

let makeDogResult = (name : string) : Dog | Error => {   // or : Result<Dog>
    if (name === '') { return new Error('nope'); }
    return { name: name, age: 5 };
}
let dog0 = makeDogResult('');
log(dog0.name);  // :( Error fields "name", "message", and "stack" collide with Dog fields
log(dog0.age);  // good, error as expected
if (dog0 instanceof Error) {
    log(dog0.message);  // good
} else {
    log(dog0.age);  // good
}
if (!isError(dog0)) {
    log(dog0.name);  // good
}
if (isSuccess(dog0)) {
    log(dog0.name);  // good
} else {
    log(dog0.message);  // good, can get error message
}


let makeDogOrNull = (name : string) : Dog | null => {
    if (name === '') { return null; }
    return { name: name, age: 5 };
}
let dog1 = makeDogOrNull('');
log(dog1.name);  // good, error as expected
if (dog1 !== null) {
    log(dog1.name);  // good
} else {
    // :( no way to get a string for the error about what went wrong
}


let makeDogOrThrow = (name : string) : Dog => {
    if (name === '') { throw new Error('nope'); }
    return { name: name, age: 5 };
}
let dog2 = makeDogOrThrow('');
log(dog2.name);  // :( no compile error, you have to remember to catch errors yourself
try {
    let dog2b = makeDogOrThrow('');
    log(dog2b.name);
} catch (err2) {
    log(err2);  // good, can get error message
}


let makeDogOrErr = (name : string) : Dog | Err => {
    if (name === '') { return { err: "nope" }; }
    return { name: name, age: 5 };
}
let dog3 = makeDogOrErr('');
log(dog3.name);  // good, error as expected
if ('err' in dog3) {  // weird
    log(dog3.err);  // good, can get error message
} else {
    log(dog3.name);  // good
    log(dog3.age);
}
if (notErr(dog3)) {
    log(dog3.age);  // good
}
if (isErr(dog3)) {
    log(dog3.err);  // good
}


let makeDogOrErrObj = (name : string) : {dog? : Dog, err?: string} => {
    if (name === '') { return { err: "nope" }; }
    return { dog: { name: name, age: 5 } };
}
let {dog:dog4, err:err4} = makeDogOrErrObj('');
log(dog4.name);  // good, error as expected
if (dog4) {
    log(dog4.name);  // good
} else {
    log(err4);  // good, can get error message though it's not enforced to be defined
}
if (!err4) {
    log(dog4.name);  // :( don't check err, have to check dog
} else {
    log(err4);  // good, can get error message
}


let makeDogOrErrObjNull = (name : string) : {dog : Dog | null, err: string | null} => {
    if (name === '') { return { dog: null, err: "nope" }; }
    return { dog: { name: name, age: 5 }, err: null };
}
let {dog:dog5, err:err5} = makeDogOrErrObjNull('');
log(dog5.name);  // good, error as expected
if (dog5) {
    log(dog5.name);  // good
} else {
    log(err5);  // good, can get error message though it's not enforced to be defined
}
if (!err5) {
    log(dog5.name);  // :( don't check err, have to check dog
} else {
    log(err5);  // good, can get error message
}


let makeDogNodeStyle = (name : string) : [string | null, Dog | null] => {
    if (name === '') { return ["nope", null]; }
    return [null, { name: name, age: 5 }];
}
let [err6, dog6] = makeDogNodeStyle('');
log(dog6.name);  // good, error as expected
if (dog6) {
    log(dog6.name);  // good
} else {
    log(err6);  // good, can get error message
}
if (!err6) {
    log(dog6.name);  // :( don't check err, have to check dog
} else {
    log(err6);  // good, can get error message
}







