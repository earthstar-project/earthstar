
export let sleep = async (ms : number) : Promise<void> => {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, ms);
    });
}

export let deepCopy = <T>(obj : T) : T =>
    JSON.parse(JSON.stringify(obj));
