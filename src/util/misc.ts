import { fast_deep_equal as equal, rfdc } from "../../deps.ts";

export let deepEqual = equal;
export let deepCopy = rfdc.clone();

//================================================================================
// TIME

export let microsecondNow = () => Date.now() * 1000;

export let sleep = (ms: number) =>
  new Promise((res, rej) => {
    setTimeout(res, ms);
  });

// TODO: better randomness here
export let randomId = (): string => "" + Math.random() + Math.random();
