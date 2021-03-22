// Karma configuration
// Generated on Mon Aug 24 2020 10:35:01 GMT-0700 (Pacific Daylight Time)

/*
Earthstar notes:
How this works

Run `npm run test-in-browser` to do all these steps at once:

1. npm run clean
2. npm run build    // typescript build
3. npm run browserify-for-karma   // make a bundle from one test file
4. npm run karma    // run karma headless browser test on the bundle

The browserify step currently can only process one of the *.test.js files.
It's hardcoded in package.json in the "browserify-for-karma" step.
Change it there to run different tests.

To fix this, I think browserify would need to make a separate bundle
for each of our *.test.js files.

ALSO

The `tap` module is not browserifiable.  We tell browserify to
swap it for `tape` (see the `browser` section of package.json).

tape's API is almost identical except it doesn't have t.done(), it has t.end().
So write all the tests using t.end(), which works in both.

FUTURE IMPROVEMENTS

The npm packages `karma-browserify` and `karma-typescript` look promising
but I was not able to get them working.
*/

module.exports = function(config) {
  config.set({

    // base path that will be used to resolve all patterns (eg. files, exclude)
    basePath: '',


    // frameworks to use
    // available frameworks: https://npmjs.org/browse/keyword/karma-adapter
    frameworks: ['tap'],


    // list of files / patterns to load in the browser
    files: [
      'browserify-test-bundle/bundle.js'
    ],

    // list of files / patterns to exclude
    exclude: [
    ],

    // preprocess matching files before serving them to the browser
    // available preprocessors: https://npmjs.org/browse/keyword/karma-preprocessor
    preprocessors: {
    },

    //basePath: '.',
    //karmaTypescriptConfig: {
    //  tsconfig: './tsconfig.json',
    //},

    // test results reporter to use
    // possible values: 'dots', 'progress'
    // available reporters: https://npmjs.org/browse/keyword/karma-reporter
    reporters: ['progress'],

    // web server port
    port: 9876,


    // enable / disable colors in the output (reporters and logs)
    colors: true,


    // level of logging
    // possible values: config.LOG_DISABLE || config.LOG_ERROR || config.LOG_WARN || config.LOG_INFO || config.LOG_DEBUG
    logLevel: config.LOG_INFO,


    // enable / disable watching file and executing tests whenever any file changes
    autoWatch: false,


    // start these browsers
    // available browser launchers: https://npmjs.org/browse/keyword/karma-launcher
    browsers: ['ChromeHeadless'],


    // Continuous Integration mode
    // if true, Karma captures browsers, runs the tests and exits
    singleRun: true,

    // Concurrency level
    // how many browser should be started simultaneous
    concurrency: Infinity
  })
}
