# Using the standalone browser build

Usually you'd get Earthstar into an app by bundling it along with the rest of your code using Browserify, Webpack, Rollup, etc.

An alternative way is to use the "standalone browser build" which is a single, pre-bundled js file containing only Earthstar.  Just drop it into your HTML.

## To rebuild the files here in the earthstar repo

* Run `npm build-standalone` to generate the standalone bundle in `dist/earthstar.js` and `dist/earthstar.min.js`.

This needs to be done by hand whenever an npm version is released, and we may sometimes forget to do it.  Check the [history](https://github.com/earthstar-project/earthstar/commits/main/dist) of those files to see when they were last updated.

We used to put version numbers in the files but it was too much work to update by hand, so now they don't have version numbers.  PRs accepted to automate this process :)

## To use it in your project

The script creates a global named `earthstar` which contains all of Earthstar's exported functions etc.

Link it into your HTML in one of these ways:

* Download [one of the bundle files](https://github.com/earthstar-project/earthstar/tree/master/dist) from the `dist/` directory on github and put it into your own project directory.  In your HTML, add
```html
<script src="earthstar.min.js"></script>
```

* Or load it from a CDN:
```html
<script src="https://cdn.jsdelivr.net/npm/earthstar@6.6.1/dist/earthstar.min.js"></script>
```

We have 2 example HTML files you can start with:
* [standalone-test-local.html](https://github.com/earthstar-project/earthstar/blob/master/standalone-test-local.html)
* [standalone-test-jsdelivr.html](https://github.com/earthstar-project/earthstar/blob/master/standalone-test-jsdelivr.html)

Example usage:
```html
<script src="earthstar.min.js"></script>
<script>
    // there is now a global called "earthstar"
    let keypair = earthstar.generateAuthorKeypair('test');
    console.log(keypair);
</script>
```