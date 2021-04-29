/*
    browser-run doesn't exit automatically when the scripts are done.

    So we have to track when each test finishes, and then call window.close().

    We do this by exposing a global window.onFinish() function and having each
    test file call it when it's done, using tape's onFinish callback.

    When the expected number of files are finished, we quit.
*/

declare let window: any;
let numFinished = 0;

let numTestFiles = 17;  // <--- set this to the expected number of test files

window.onFinish = (testName?: string) => {
    numFinished += 1;
    if (numFinished === 1) { console.log(' '); }
    console.log(`onFinish handler ${numFinished} / ${numTestFiles} ${testName ?? ''}`);
    if (numFinished === numTestFiles) {
        console.log('    if the number of tests is not as expected, change the number in browser-run-exit.ts');
        console.log('    closing browser in a moment...');
        setTimeout(() => {
            console.log('    closing browser now');
            window.close();
        }, 100);
    }
}