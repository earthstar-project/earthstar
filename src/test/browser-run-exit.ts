/*
    browser-run doesn't exit automatically when the scripts are done.

    So we have to track when each test finishes, and then call window.close().

    We do this by exposing a global window.onFinish() function and having each
    test file call it when it's done, using tape's onFinish callback.

    When the expected number of files are finished, we quit.
*/

declare let window: any;
let numFinished = 0;

let numTestFiles = 12;  // <--- set this to the expected number of test files

window.onFinish = (testName?: string) => {
    numFinished += 1;
    if (numFinished === 1) { console.log(' '); }
    console.log(`onFinish handler ${numFinished} / ${numTestFiles} ${testName ?? ''}`);
    if (numFinished === numTestFiles) {
        console.log('    closing browser...');
        setTimeout(() => {
            window.close();
        }, 50);
    }
}