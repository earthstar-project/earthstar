
export let log = console.log;

export let nop = (...args: any[]): void => {};

export let debugWithTag = (tag: string, ...args: any[]) => {
    console.log(tag, ...args);
}

export let makeDebug = (tag: string) => {
    return (...args: any[]) => {
        console.log(tag, ...args);
    }
}

