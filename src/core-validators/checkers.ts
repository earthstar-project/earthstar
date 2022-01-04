import { stringLengthInBytes } from "../util/bytes.ts";
import { onlyHasChars } from "./characters.ts";

//================================================================================

// Similar to JSON schema, these functions help check if
// data is in the expected format.
// A "checker" function returns null on success, or a string on error.

type Ob = { [k: string]: any };

export type Checker = (x: any) => null | string; // returns err, which can be null
export type CheckerSchema = {
  [k: string]: Checker;
};

//================================================================================

export let isPlainObject = (obj: any): obj is Ob => {
  if (Object.prototype.toString.call(obj) !== "[object Object]") {
    return false;
  }
  // reject class instances
  if (("" + obj.constructor).startsWith("class")) return false;
  return true;
};
export let checkIsPlainObject: Checker = (x: any): null | string =>
  isPlainObject(x) ? null : "expected plain object but got " + x;

//================================================================================

export let checkLiteral = (val: any): Checker =>
  (x: any): null | string => {
    if (x !== val) return `expected literal value ${JSON.stringify(val)}`;
    return null;
  };

//================================================================================

export interface CheckStringOpts {
  optional?: boolean; // default false
  minLen?: number; // minimum allowable length (inclusive) (counting utf-8 bytes)
  maxLen?: number; // maximum allowable length (inclusive) (counting utf-8 bytes)
  len?: number; // same as setting minLen and maxLen to the same number
  allowedChars?: string; // all the characters that our checked string is allowed to have
}
export let checkString = (opts: CheckStringOpts = {}): Checker =>
  (x: any): null | string => {
    if (opts.optional !== true && x === undefined) return "required";
    if (opts.optional === true && x === undefined) return null; // skip the rest of the checks if it's undefined

    //let len = x.length;  // TODO: string length or byte length?
    let len = stringLengthInBytes(x);
    if (typeof x !== "string") {
      return "expected a string but got " + JSON.stringify(x);
    }
    if (opts.minLen !== undefined && len < opts.minLen) {
      return `string shorter than min length of ${opts.minLen} chars`;
    }
    if (opts.maxLen !== undefined && len > opts.maxLen) {
      return `string shorter than max length of ${opts.maxLen} chars`;
    }
    if (opts.len !== undefined && len !== opts.len) {
      return `string does not have required length of ${opts.len} chars: ${x}`;
    }
    if (
      opts.allowedChars !== undefined && !onlyHasChars(x, opts.allowedChars)
    ) {
      return "contains disallowed characters";
    }
    return null;
  };

//================================================================================

export interface CheckIntOpts {
  optional?: boolean; // default false
  nullable?: boolean; // default false
  min?: number; // inclusive
  max?: number; // inclusive
}
export let checkInt = (opts: CheckIntOpts = {}): Checker =>
  (x: any): null | string => {
    if (opts.optional !== true && x === undefined) return "required";
    if (opts.optional === true && x === undefined) return null; // skip the rest of the checks if it's undefined
    if (opts.nullable !== true && x === null) return "not nullable";
    if (opts.nullable === true && x === null) return null; // skip the rest of the checks if it's null

    if (typeof x !== "number") {
      return "expected a number but got " + JSON.stringify(x);
    }
    if (isNaN(x)) return "is NaN";
    if (!isFinite(x)) return "is Infinity";
    if (x !== Math.round(x)) return "expected an integer";
    if (opts.min !== undefined && x < opts.min) {
      return `integer too small (must be >= ${opts.min})`;
    }
    if (opts.max !== undefined && x > opts.max) {
      return `integer too large (must be <= ${opts.max})`;
    }
    return null;
  };

//================================================================================

export interface CheckObjOpts {
  allowLiteralUndefined?: boolean; // default false.  allow values in the object to be explicitly set to undefined (rather than omitted)?
  allowExtraKeys?: boolean; // default false.  allow keys not set in objSchema?  to use this, you must also define objSchema
  objSchema?: CheckerSchema; // an object of validators
}
export let checkObj = (opts: CheckObjOpts = {}): Checker => {
  // set defaults
  opts.allowLiteralUndefined = opts.allowLiteralUndefined ?? false;
  opts.allowExtraKeys = opts.allowExtraKeys ?? false;
  return (x: any): null | string => {
    if (!isPlainObject(x)) return "expected an object";
    if (opts.allowLiteralUndefined === false) {
      // don't allow any keys to be literally undefined, e.g. exiting but set to undefined.
      // when this is false, optional keys have to be omitted instead of set to undefined.
      for (let [k, v] of Object.entries(x)) {
        if (v === undefined) {
          return `${k} is explicitly set to undefined but should be missing instead`;
        }
      }
    }
    if (opts.objSchema !== undefined) {
      // look for extra keys
      if (opts.allowExtraKeys === false) {
        let objKeys = Object.keys(x);
        let schemaKeys = Object.keys(opts.objSchema);
        let extraObjKeys = objKeys.filter((k) => schemaKeys.indexOf(k) === -1);
        if (extraObjKeys.length > 0) {
          return `object has extra keys not in the schema: ${
            extraObjKeys.join(", ")
          }`;
        }
      }
      // check the individual schemas of each key
      for (let [key, validator] of Object.entries(opts.objSchema)) {
        let err = validator(x[key]);
        if (err !== null) return `${key}: ${err}`;
      }
    }
    return null;
  };
};
