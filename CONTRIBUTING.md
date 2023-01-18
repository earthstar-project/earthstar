# Contributing to Earthstar

Earthstar is a non-profit project aiming to create a freer, fairer internet. As
such it relies on freely given contributions of volunteers to progress. If you'd
like to contribute, firstly, thank you! Secondly, the information below will be
useful to you.

## Purpose

The goal of this project is to make it easy for people and communities to have
their own communications infrastructure, independent of big tech companies and
people with specialised tech skills.

This communications infrastructure should be resilient, non-capitalist and under
local control. This is accomplished by having a distributed network of peers and
servers which are each cheap and easy to run.

## Values

We aim to serve people such as:

- People kicked off Facebook because of "real name policies" that enforce
  cultural assumptions about names
- Queer communities kicked off platforms such as Tumblr
- People organizing mutual aid groups who don't want to put their data on
  Google's servers
- People seeking a calmer, less addictive way of communicating, free of ads and
  data collection
- People with low-spec devices
- People in off-grid settings with intermittent internet connectivity

Although Earthstar lets you use small servers under your own control, it does
NOT provide enough anonymity to keep you safe from governments. It would fit our
values, but it's a hard problem beyond the scope of this project. You can use
Earthstar through other network-privacy tools such as Tor.

We explicitly do NOT want to help hate groups and people doing harm who have
been deplatformed by large tech companies.

If you are using Earthstar for the purpose of harming people or hosting
communities that are about harming people, you will be banned from the project.

## Code of conduct

[Please read the Code of Conduct here](CODE_OF_CONDUCT.md).

The software we make, and the community here in which we make it, should be
accessible to everyone — especially people who are not historically privileged
in tech spaces.

## Discuss ideas

- by opening an issue on this repo
- or in the [Discord](https://discord.gg/EFJnuyKbTv) server

Pull requests are welcome! If they are new ideas, consider discussing the idea
first.

[Gwil](mailto:sam@gwil.garden) is the Benevolent Steward For Now and has
decision-making power. Gwil will step back from this role once there are enough
contributors.

## Security

While Earthstar is young and not widely used, you can discuss security issues on
Github.

Otherwise, report security issues to [gwil](mailto:sam@gwil.garden). See the
[code of conduct](CODE_OF_CONDUCT.md) document for contact information.

## Setting up for development

This module uses Deno as its development runtime.
[Installation instructions can be found here](https://deno.land/#installation).

Deno has a Language Service Provider which your text editor of choice may be
able to use to provide autocompletion, documentation, linting, typechecking and
more.

## Codebase overview

To get a sense of where things in the codebase are, please see
[ARCHITECTURE](architecture.md).

## Testing

Tests are kept in `src/tests`. They can be run with `deno task test` or
`deno task test-watch`.

To run tests on Node, run `deno task npm`. This will build the NPM distribution
of Earthstar locally and run tests against it with Node.

We do not yet have browser tests.

## Code style

### Formatting

Run `deno fmt src` and the codebase will be formatted automatically.

### Limited dependencies and Web APIs.

Avoid adding new dependencies. Choose dependencies carefully; favor well-known
and mature modules with few dependencies of their own. Always prefer Web APIs
when they are widely supported!

### Documentation and comments

We use JSDoc for user documentation. You can view docs for the whole codebase at
https://doc.deno.land/https://deno.land/x/earthstar/mod.ts, or by running the
following from the root of the project:

```
deno doc mod.ts
```

JSDocs are intended for end-users of the library. Comments for contributors
working with the codebase — e.g. notes on how something is implemented — are
better as standard JS comments.

If possible, use a single line for the JSDoc. Example:

```ts
/** Does something great */
export function doSomething() {
  // ...
}
```

You can use markdown inside of JSDoc block. While markdown supports HTML tags,
it is forbidden in JSDoc blocks.

Code string literals should be braced with the back-tick (\`) instead of quotes.
For example:

```ts
/** Import something from the `earthstar` module. */
```

It's not necessary to document function arguments unless an extra explanation is
warranted. Therefore `@param` should generally not be used. If `@param` is used,
it should not include the `type` as TypeScript is already strongly typed.

```ts
/**
 * Function with non obvious param.
 * @param nonObvious Description of non obvious parameter.
 */
```

Code examples should utilize markdown format, like so:

````ts
/** A straight forward comment and an example:
 * ```ts
 * import { Crypto } from "stone-soup";
 * const keypair = Crypto.generateAuthorKeypair("suzy");
 * ```
 */
````

Code examples should not contain additional comments and must not be indented.
It is already inside a comment. If it needs further comments it is not a good
example.

Exported functions should use the `function` keyword, and not be defined as
inline functions assigned to variables. The main reason for this being that they
are then correctly categorised as functions.

### Errors and exceptions

When a function can have expected kinds of errors, return an Error from the
function instead of throwing it. This helps Typescript to understand the
function better and ensures the people calling the function later will be aware
of all the possible errors.

```typescript
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

Use subclasses of the standard Error class. Prefer these specific errors to the
generic built-in `Error`.

```typescript
class EarthstarError extends Error { ... }

class ValidationError extends EarthstarError { ... }
class StorageIsClosedError extends EarthstarError { ... }
... etc ...
```

It's ok to throw an error in these cases:

- A function is not implemented yet
- Class constructors can't return a value, so you can throw an exception there.
  This happens in the replica classes.
- If the programmer made an obvious mistake, you can throw an error.
  - Very wrong function arguments
  - Using a replica instance after closing it
  - Low-level system errors like missing files
