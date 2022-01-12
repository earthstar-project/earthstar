import { rfdc } from "../../deps.ts";
export { fast_deep_equal as deepEqual } from "../../deps.ts";

//================================================================================
// TIME

export const deepCopy = rfdc();

export let microsecondNow = () => Date.now() * 1000;

export let sleep = (ms: number) =>
    new Promise((res, rej) => {
        setTimeout(res, ms);
    });

// TODO: better randomness here
export let randomId = (): string => "" + Math.random() + Math.random();

// replace all occurrences of substring "from" with "to"
export let replaceAll = (str: string, from: string, to: string): string => {
    return str.split(from).join(to);
};

// how many times does the character occur in the string?
export let countChars = (str: string, char: string) => {
    if (char.length != 1) { throw new Error('char must have length 1 but is ' + JSON.stringify(char)); }
    return str.split(char).length - 1;
};

export let isObjectEmpty = (obj: Object): Boolean => {
    return Object.keys(obj).length === 0;
};
