export { fast_deep_equal as deepEqual } from "../../deps.ts";

//================================================================================
// TIME

export function microsecondNow() {
  return Date.now() * 1000;
}

/** Returns a promise which is fulfilled after a given number of milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((res) => {
    setTimeout(res, ms);
  });
}

// TODO: better randomness here
export function randomId(): string {
  return "" + Math.random() + Math.random();
}

// replace all occurrences of substring "from" with "to"
export function replaceAll(str: string, from: string, to: string): string {
  return str.split(from).join(to);
}

// how many times does the character occur in the string?

export function countChars(str: string, char: string) {
  if (char.length != 1) {
    throw new Error("char must have length 1 but is " + JSON.stringify(char));
  }
  return str.split(char).length - 1;
}

export function isObjectEmpty(obj: Object): Boolean {
  return Object.keys(obj).length === 0;
}
