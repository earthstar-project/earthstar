# Earthstar

> This is a beta release of Earthstar 11, and is still in progress!

[Earthstar](https://earthstar-project.org) is a general purpose distributed data
store, designed with the social realities of peer-to-peer computing kept in
mind. It is powered by [Willow](https://willowprotocol.org).

This is a reference implementation written in Typescript, powered by
[willow-js](https://github.com/earthstar-project/willow-js). You can use it to
add Earthstar functionality to applications running on servers, browsers, the
command line, or anywhere else JavaScript can be run.

[Detailed API documentation for this module can be found here](https://jsr.io/@earthstar/earthstar@11.0.0-beta.1/doc).

This document is concerned with the usage of this module's APIs. To learn more
about what Earthstar is, please see these links:

- [What is Earthstar?](https://earthstar-project.org/docs/what-is-it)
- [How does Earthstar work?](https://earthstar-project.org/docs/how-it-works)

To learn more about running Earthstar servers, see
[README_SERVERS](README_SERVERS.md)

To learn about contributing to this codebase, please see
[CONTRIBUTING](CONTRIBUTING.md).

## Getting started

We're just getting started too (i.e. with this README), so for now get started
with this:

```ts
const peer = new Peer({
  password: "password1234",
  runtime: new RuntimeDriverUniversal(),
  storage: new StorageDriverMemory();,
});
```
