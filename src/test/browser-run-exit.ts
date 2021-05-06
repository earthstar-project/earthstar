/*
    browser-run doesn't exit automatically when the scripts are done.

    So each test fil needs to use tape's t.onFinish callback to call
    this function, below.

    This ensure that the browser window closes eventually, which
    lets the program exit.
*/

let firstTime: boolean = true;
export let onFinishOneTest = (testName?: string, subtestName?: string) => {
    if (firstTime) { console.log('----------- tests run: -----------'); }
    firstTime = false;

    console.log(testName + (subtestName ? ' -- '+ subtestName : ''));

    setTimeout(() => {
        console.log('----------------------------------');
        console.log('    closing browser now');
        window?.close();
    }, 50);
}
