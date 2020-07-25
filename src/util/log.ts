let nop = (...args : any[]) => void {};

export let logDebug = nop;
export let logTest = console.log;
export let logWarning = console.log;
