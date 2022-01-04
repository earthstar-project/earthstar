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
