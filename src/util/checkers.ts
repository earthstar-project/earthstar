import {
    onlyHasChars,
} from './characters';

// Similar to JSON schema, these functions help check if
// data is in the expected format.
// A "checker" function returns null on success, or a string on error.

type Ob = {[k : string] : any}

export type Checker = (x : any) => null | string;
export type CheckerSchema = {
    [k:string]: Checker,
}

export let isPlainObject = (obj : any) : obj is Ob =>
    Object.prototype.toString.call(obj) === '[object Object]'
export let checkIsPlainObject : Checker = (x : any) : null | string =>
    isPlainObject(x) ? null : 'expected plain object but got ' + x;


export interface CheckStringOpts {
    optional?: boolean,  // default false
    minLen?: number,
    maxLen?: number,
    allowedChars?: string,
}
export let checkString = (opts : CheckStringOpts) : Checker =>
    (x : any) : null | string => {
        if (x === undefined && opts.optional === false) { return 'required'; }
        if (typeof x !== 'string') { return 'expected a string but got ' + JSON.stringify(x); }
        if (opts.minLen !== undefined && x.length < opts.minLen) { return 'too short'; }
        if (opts.maxLen !== undefined && x.length > opts.maxLen) { return 'too long'; }
        if (opts.allowedChars !== undefined && !onlyHasChars(x, opts.allowedChars)) { return 'contains disallowed characters'; }
        return null;
    }

export interface CheckIntOpts {
    optional?: boolean,  // default false
    min?: number,  // inclusive
    max?: number,  // inclusive
}
export let checkInt = (opts : CheckIntOpts) : Checker =>
    (x : any) : null | string => {
        if (x === undefined && opts.optional === false) { return 'required'; }
        if (typeof x !== 'number') { return 'expected a number but got ' + JSON.stringify(x); }
        if (x !== Math.round(x)) { return 'expected an integer'; }
        if (opts.min !== undefined && x < opts.min) { return 'too small'; }
        if (opts.max !== undefined && x > opts.max) { return 'too large'; }
        return null;
    }

export interface CheckObjOpts {
    allowUndefined?: boolean, // default false.  allow value in the object to be explicitly set to undefined?
    allowExtraKeys?: boolean, // default false.  allow keys not set in objSchema?  to use this, you must also define objSchema
    objSchema?: CheckerSchema,  // an object of validators
}
export let checkObj = (opts : CheckObjOpts) : Checker =>
    (x : any) : null | string => {
        if (!isPlainObject(x)) { return 'expected an object'; }
        if (opts.allowUndefined === false || opts.allowUndefined === undefined) {
            // look for explicit undefined
            for (let [k, v] of Object.entries(x)) {
                if (v === undefined) { return `${k} is explicitly undefined but should be missing instead` }
            }
        }
        if (opts.objSchema !== undefined) {
            // look for extra keys
            if (opts.allowExtraKeys === false || opts.allowExtraKeys === undefined) {
                let objKeys = Object.keys(x);
                let schemaKeys = Object.keys(opts.objSchema);
                let extraObjKeys = objKeys.filter(k => schemaKeys.indexOf(k) === -1);
                if (extraObjKeys.length > 0) { return `object has extra keys not in the schema: ${extraObjKeys.join(', ')}`; }
            }
            // check the individual schemas of each key
            for (let [key, validator] of Object.entries(opts.objSchema)) {
                let err = validator(x[key]);
                if (err) { return `${key}: ${err}`; }
            }
        }
        return null;
    }
