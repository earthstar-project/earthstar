<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Contents**

- [How to track causal relationships more carefully: version vectors](#how-to-track-causal-relationships-more-carefully-version-vectors)
    - [But: we need device ids](#but-we-need-device-ids)
  - [Version vector example](#version-vector-example)
  - [Space requirements](#space-requirements)
    - [No version vectors](#no-version-vectors)
    - [Extra overhead from version vectors](#extra-overhead-from-version-vectors)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->


2020-05-30

# How to track causal relationships more carefully: version vectors

How to deal with possible conflicts within the document versions of a certain path.  (Documents at different paths will have no relationship to each other.)

2 strategies:

1. Rearrange the entire app experience to **avoid conflicts at all**, wherever possible.  So maybe you wouldn't make something exactly like a classic wiki, instead each page would have an explicit owner.  You can do this by putting a tilde in the path to restrict writes to only one person like `/wiki/~@aaaa.xxx/Kittens`.  You could render a kind of overlay filesystem merging different people's data together on the fly.

2. Use **version vectors** at the app level (Earthstar doesn't do it for you).  See below.

### But: we need device ids

Version vectors work best if we track which device each write happened from.  We might need to modify Earthstar to keep the latest document version from each author-device combo, not just from each author.

This could all be done without deviceIds, but we would lose some information about the causal relationships between writes by the same author from different devices.  This might be acceptable.

## Version vector example 

Here's a history of 3 writes to the same path, assuming we change Earthstar to track devices as well as authors.

`deviceId` is a persistent, random UUIDs that's distinct on each physical device (laptop, etc).

```
path: /wiki/Kittens
author: @aaa
deviceId: ppppp,
timestamp: 11111
content: {
    text: "Purr",
    supersedes: []
}

path: /wiki/Kittens
author: @bbb
deviceId: mmmmm,
timestamp: 12345
content: {
    text: "MeowMeow",
    // The version vector, called "supersedes" here,
    // is inside the content because
    // the app is responsible for this, not Earthstar.
    // This document version by @bbb comes after the ones
    // listed in the array.
    supersedes: [@aaa on device ppppp at time 11111],
}

path: /wiki/Kittens
author: @aaa
deviceId: ppppp,
timestamp: 13333
content: {
    text: "PurrPurrPurr",
    // This particular version comes after the original
    // one by @aaa, and is unaware of the one by @bbb.
    // A document version is always assumed to supersede
    // previous versions from the same author and device,
    // so we don't need to add anything to
    // the version vector.
    supersedes: [],
}
```

Causal diagram
```
          (@aaa Purr)
          |         |
          v         v
  @bbb MeowMeow    @aaa PurrPurrPurr
```

AAA wrote Purr, BBB modified it to MeowMeow, and AAA never saw BBB's edit and overwrote their own Purr with PurrPurrPurr.  This would cause the original Purr to get deleted since we only keep one history item per author, so we end up with only Meow and PurrPurrPurr in our database.

So we only have the lower two document versions and we need to decide if they're siblings in the causal graph (conflicts / forks), or if one precedes the other and can be ignored.

Because we delete some history, regular hash backlinks end up as dangling references and we can't figure out what was going on.  Instead I've used version vectors (author-device-timestamp backlinks) because they contain enough info about ordering despite gaps in the document history.  Here we can tell that MeowMeow should supersede Purr, but MeowMeow and PurrPurrPurr are siblings in the causal graph (they are unaware of each other at the time they were written).

We need to add the concept of "device ids" here, because an author can use multiple devices simultaneously.  A stream of edits from a single author on a single device is guaranteed to be in perfect causal order, so it's a building block we can rely on.

To compare two version vectors, match up their individual timestamps by author-and-device.  If vector A's timestamps are each larger than the matching ones in vector B, then vector A is a causal descendent of vector B (A supersedes B).  If some of A's timestamps are higher and some of B's timestamps are higher, they are siblings (conficts / forks).

## Space requirements

Each document will have N-1 items in its version vector, where N is the number of unique author-device combos that have written to that particular path.

Assume 3 devices per author, 5 authors write 500 versions of a document to each path, and 10,000 paths in the workspace.  Assume each document version is 1 kilobyte without version vectors.

The 500 number is irrelevant because we only keep the newest version from each author.

### No version vectors

Entire workspace = 5 authors * 10,000 paths * 1 kilobyte = **50 mb.**

### Extra overhead from version vectors

Each document version will have (3 * 5) - 1 = 14 elements in the version vector.

Each element is an author address, a timestamp, and a deviceId, maybe totalling 100 bytes.

Overhead = 1400 bytes per document version that we keep (which is 5 documents, one from each author) = 7 kB total extra storage per path.

That's **70 mb extra space used just for version vectors**, plus 50 mb of the original data.


