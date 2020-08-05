# Contributing to Earthstar

## Purpose

The goal of this project is to make it easy for people and communities to have their own communications infrastructure, independent of big tech companies and people with specialized tech skills.

This communications infrastructure should be **non-capitalist** and **under local control**.  This is accomplished by having a distributed network of p2p connections and small servers which are each cheap and easy to run.

The [Rules Of Earthstar](docs/rules-of-earthstar.md) document discusses the goals, priorities, and scope of this project, as well as the technical details of the underlying distributed system.

## Values

We aim to serve people such as:
* People kicked off Facebook because of "real name policies" that enforce cultural assumptions about names
* Queer communities kicked off platforms such as Tumblr
* People organizing mutual aid groups who don't want to put their data on Google's servers
* People seeking a calmer, less addictive way of communicating, free of ads and data collection
* People with low-spec devices
* People in off-grid settings with intermittant internet connectivity

Although Earthstar lets you use small servers under your own control, it does NOT provide enough anonymity to keep you safe from governments.  It would fit our values but it's a hard problem beyond the scope of this project.  You can use Earthstar through other network-privacy tools such as Tor.

We explicitly do NOT want to help hate groups and people doing harm who have been deplatformed by large tech companies.

If you are using Earthstar for the purpose of harming people or hosting communities that are about harming people, you will be banned from the project.

## Code of conduct

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

The software we make, and the community here in which we make it, should be accessible to everyone -- especially people who are not historically privileged in tech spaces.

## Communication, collaboration, and decision making

Discuss ideas
* by opening an issue on this repo
* or in the [`#earthstar:matrix.org`](https://matrix.to/#/!oGfoMKqZnBVrJYjebW:matrix.org) channel
* or using the #earthstar tag on SSB, though it's hard to guarantee that everyone will see things on SSB

Pull requests are welcome!  If they are new ideas, consider discussing the idea first.

Cinnamon is the Benevolent Steward For Now and has decision-making power.  Cinnamon will step back from this role once there are enough contributors.

## Security

While Earthstar is young and not widely used, you can discuss security issues on Github.

Otherwise, report security issues to Cinnamon.  See the [code of conduct](CODE_OF_CONDUCT.md) document for contact information.

## Code style

Use `async`/`await` when handling promises.

Prefer `const` over `let` when possible, but it's not a strict rule.  Don't use `var`.

### Null and undefined

Avoid using `undefined` when possible.  `undefined` tends to occur accidentally (when looking up an object property that doesn't exist), and it can also be ambiguous when an object has an `undefined` property vs. not having the property at all.

Instead, use `null`.

### Errors and exceptions

When a function can have expected kinds of errors, return an Error from the function instead of throwing it.  This helps Typescript to understand the function better and ensures the people calling the function later will be aware of all the possible errors.

```ts
// return result or Error
let divideNumbers(a: number, b: number): number | EarthstarError => {
    if (b === 0) { return new EarthstarError("can't divide by zero"); }
    return a / b;
}

// check for errors like this:
let n = divideNumbers(1, 2);
if (n instanceof EarthstarError) {
    // do something
} else {
    // n is a number
}

// or use the helper functions from types.ts
if (isErr(n)) { ... }
if (notErr(n)) { ... }
```

Use subclasses of the built-in node Error class.  They're defined in [types.ts](src/util/types.ts).  Prefer these specific errors to the generic built-in `Error`.

```ts
class EarthstarError extends Error { ... }

class ValidationError extends EarthstarError { ... }
class StorageIsClosedError extends EarthstarError { ... }
... etc ...
```

It's ok to throw an error in these cases:
* A function is not implemented yet
* Class constructors can't return a value, so you can throw an exception there.  This happens in the Storage classes.
* If the programmer made an obvious mistake, you can throw an error.
  * Very wrong function arguments
  * Using a Storage instance after closing it
  * Low-level system errors like missing files

### Modules and files

`src/util/types.ts` is the home for widely used types and interfaces.  If a type will be used in more than one file, put it here.

`src/crypto/cryptoTypes.ts` is an exception; it holds types for the crypto related code.

### Limited dependencies

Avoid adding new dependencies.  Choose dependencies carefully; favor well-known and mature modules with few dependencies of their own.

### Avoid streams

Node streams are confusing and inaccessible to many people.  Instead of streams, Earthstar generally does things in batches.  For example: fetch 1000 documents at a time, in a loop, then get the next 1000, etc.

This applies to regular code and network responses.

## Code formatting

We are not strict about code formatting.

There is a `.prettierrc` set up in this repo but I find myself fighting with it often so I've stopped using it.  Code does not have to be mechanically formatted.  Lay out your code for humans to read.

Long lines of code are ok (> 80 characters) -- turn on word-wrap in your editor if they don't fit.

### Capitalization

```ts
CONSTANT_VALUE
variableName
ClassName
TypeName
IStorage  // The main interfaces start with "I".
          // These are the interfaces that the main classes implement as their APIs.
          // (It doesn't matter if it's technically a Typescript interface or type.)

// when capitalizing, treat acronyms as if they were words.
serveJsonOverHttp()  // not serveJSONOverHTTP()
```

JSON also uses camelCase:

```json
{
    "deleteAfter": 12345,
}
```

### Whitespace, semicolons, punctuation

Use semicolons.  Format functions like this:

```ts
let exampleFunction = (x: number): number => {
    return x * 2;
}

let oneLinerFunction = (x: number): number =>
    x * 2;
```

Object literals written on one line should have spaces inside the curly brackets:

```ts
let myObject = { a: 1, b: 2, c:3 };
//       spaces ^               ^
```

Some old code has a space before type-related colons, which we don't want.  This can be fixed with the built-in code formatter in VSCode (command-shift P, then "format selection").

```ts
// no
let square = (x : number) : number =>
    x * x;

// yes
let square = (x: number): number =>
    x * x;
```

Prefer single quotes to double quotes:

```ts
let yes = 'yes';
let no = "no";
let ok = "I'm a string with an apostrophe so I can use double quotes";
```

### Imports

Imports come in 3 sections, separated by blank lines:
1. built-in node modules
2. external modules
3. internal modules, in loose order from low-level to high-level

If importing more than one thing from a file, put each thing on a separate line and sort them alphabetically.

No circular dependencies (two files should not import each other).

```ts
// built-ins
import * as fs from 'fs';

// external
import { deepEqual } from 'fast-equals';

// internal
import {
    AuthorAddress,  // in alphabetical order
    AuthorKeypair,
    Path,
    WorkspaceAddress,
} from '../util/types';
import { sign } from '../crypto/crypto';
```
