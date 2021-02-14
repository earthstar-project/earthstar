# Tutorial: Making an Earthstar app

Let's make a Todo list app!  It will use the same data format as [the one in Earthstar Foyer](https://earthstar-foyer.netlify.app/), so you can view your data there too.

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Contents**

- [Read the tutorial code](#read-the-tutorial-code)
- [Run the tutorial code](#run-the-tutorial-code)
- [Also try the command-line tool](#also-try-the-command-line-tool)
- [Review: Earthstar in 30 seconds](#review-earthstar-in-30-seconds)
- [In detail: how to plan your data storage in Earthstar](#in-detail-how-to-plan-your-data-storage-in-earthstar)
  - [How data works in Earthstar](#how-data-works-in-earthstar)
  - [Choose a unique name for your app](#choose-a-unique-name-for-your-app)
  - [Divide your data into small pieces](#divide-your-data-into-small-pieces)
  - [Plan for chaos](#plan-for-chaos)
  - [Plan for efficient querying](#plan-for-efficient-querying)
  - [Avoid sequential id numbers](#avoid-sequential-id-numbers)
  - [Decide who can edit documents](#decide-who-can-edit-documents)
  - [Storing binary data](#storing-binary-data)
  - [Size limits](#size-limits)
  - [Saving space](#saving-space)
    - [1. Re-use old paths](#1-re-use-old-paths)
    - [2. Use ephemeral messages](#2-use-ephemeral-messages)
  - [Our final plan for data storage](#our-final-plan-for-data-storage)
  - [Put all that Todo code into a Layer](#put-all-that-todo-code-into-a-layer)
- [Making apps](#making-apps)
  - [Kinds of apps](#kinds-of-apps)
  - [Web apps](#web-apps)
  - [React](#react)
  - [Vue](#vue)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

# Read the tutorial code

Start by reading
**[tutorial.js](tutorial.js)** -- most of the tutorial is in the comments there.

The rest of *this* document is extra details.

# Run the tutorial code

```sh
# set up a little node project and install earthstar.
mkdir toboop
cd toboop
npm init --yes

# install earthstar as a dependency.
# this takes a minute; it has to compile SQLite for you.
npm install --save earthstar

# get tutorial.js, or just copy-paste it from github.
curl https://raw.githubusercontent.com/earthstar-project/earthstar/master/docs/tutorial.js > tutorial.js

# run it.
node tutorial.js
```

# Also try the command-line tool

[earthstar-cli](https://github.com/earthstar-project/earthstar-cli) is a little command line utility for working with Earthstar databases -- adding documents, syncing, etc.

```sh
npm install --global earthstar-cli

earthstar --help
# or read the README on github to learn more
```

# Review: Earthstar in 30 seconds

It's a p2p document database.  Each person has a copy of all the data on their own machine.  They sync with each other.

Users are called "authors" and are identified with short names and public keys, like `@suzy.bjzee56v2hd6mv5r5a...`.

"Pub servers" in the cloud help keep data online, but they have no authority over users.  They are just peers like everyone else.

Users sign their documents; nobody can tamper with them as they travel through the network.

Earthstar doesn't encrypt your data but since everyone has a public and private key, you can encrypt and decrypt data yourself.

A "workspace" is like a shared folder; it's the way we divide up the world into small groups of users and their data.  Workspace names look like `+gardening.bja0q349ja`.  Knowing a workspace name lets you access the data, so only share it with your friends.

There is not a huge global space of data and users.  There are lots of small workspaces which are separate and independent.

# In detail: how to plan your data storage in Earthstar

We'll evolve our plan as we work through these steps:

## How data works in Earthstar

Imagine if your app's data was stored as a bunch of small files in a folder, and you were using Dropbox to sync it with other users.
How would you divide up your data into files?
We'll use a similar strategy in Earthstar.

Earthstar data is stored in Documents.  Each document has a Path and some Content.

Imagine it like this:

```
Documents in the workspace +example.bqvho348ihqo48ghqqog

Path                 Content       
----                 ----          
/todos/0001.txt      Get apples    
/todos/0002.txt      Go for a walk 
/todos/0003.txt      Play banjo
```

This is almost like a filesystem except there's no entries for folders, only for files.  For example there's no entry for the folder `/todos/` -- it's existence is implied by the deeper items.

So this is actually a key-value store, like leveldb, and the entire path is the key.

Documents can be modified.  You can "delete" them by just overwriting them with an empty string as the content.

> An actual document has more fields like `author` and `timestamp` that we can ignore for now:
> 
> ```json
> {
>   "author": "@suzy.bjzee56v2hd6mv5r5ar3xqg3x3oyugf7fejpxnvgquxcubov4rntq",
>   "content": "Flowers are pretty",
>   "contentHash": "bt3u7gxpvbrsztsm4ndq3ffwlrtnwgtrctlq4352onab2oys56vhq",
>   "format": "es.4",
>   "path": "/wiki/shared/Flowers",
>   "signature": "bjljalsg2mulkut56anrteaejvrrtnjlrwfvswiqsi2psero22qqw7am34z3u3xcw7nx6mha42isfuzae5xda3armky5clrqrewrhgca",
>   "timestamp": 1597026338596000,
>   "workspace": "+gardening.friends",
> }
> ```

## Choose a unique name for your app

Your app will coexist with other apps inside the same Earthstar workspace.  Maybe there are other Todo apps that work differently.  Let's choose a unique name so our documents don't collide with another app.

The app name should be the first component of the path:

```
/toboop/...
```

## Divide your data into small pieces

Two people might edit the same document at the same time.  Earthstar doesn't merge those conflicts, it just chooses the most recent one as the winner.

In our Todo app, each todo has a checkbox state and a text label.  If I check a box and you edit the text label, we want both of those changes to survive.  That means we need 2 documents for each Todo:

```
/toboop/0001/text.txt       // content: a string
/toboop/0001/isDone.json    // content: true or false
```

## Plan for chaos

When Earthstar syncs, documents can arrive in any order, and some might not arrive for a long time.

There are no transactions or batch writes.

Your app should continue working if any documents are randomly missing or haven't been updated for a while.

To make this easier to think about, let's say that the `text.txt` document is the "primary" one -- we only consider a Todo to exist if the "primary" document exists.

## Plan for efficient querying

The most efficient way to query your documents is by path prefix -- fetching all the documents with paths starting with a certain string.

The kind of path we're using works well because we can get all the documents related to a Todo with this query:

```js
// queries are written as JSON style objects

{ pathStartsWith: "/toboop/0001/" }
```

## Avoid sequential id numbers

But this is a distributed system and we need to make sure new Todos are created with unique IDs.  There's no central place to give out unique sequential integers.

Instead, choose one strategy:
1. Use randomly generated UUIDs
2. Use timestamps combined with some randomness to avoid rare accidental collisions.

Let's choose #2, because the paths will be conveniently sorted by creation time.

```ts
// strategy 2: timestamp combined with randomness

// utility: generate a random integer, inclusive of endpoints
let randInt = (lo: number, hi: number) =>
    Math.floor(Math.random() * ((hi+1) - lo) + lo);

// make an id like "1606164670376000:7898789"
let generateTodoId = (): string =>
    `${Date.now() * 1000}:${randInt(1000000, 9999999)}`;
```

*Microseconds*, not milliseconds, are used for timestamps throughout Earthstar, so let's follow that convention here and multiply `Date.now()` by 1000 to get microseconds.

Now our paths are like:

```ts
/toboop/1606164670376000:7777777/text.txt     // content: a string
/toboop/1606164670376000:7777777/isDone.json  // content: true or false
```

> If you need to put strings into your paths, such as Wiki page titles, check the [specification: write permissions](https://github.com/earthstar-project/earthstar/blob/master/docs/specification.md#paths-and-write-permissions) for details on character limits, how to encode unicode characters, etc.

## Decide who can edit documents

By default, anyone can edit any document.

If a document path contains `"~"` + the name of an author, only that author can edit it.  For example:

```ts
// only @suzy.b02ho4... can create or edit this document:
/toboop/~@suzy.bo2ho498fqho4fo8j/1606164670376000:7777777/text.txt
```

In our Todo example we'll leave all documents editable by anyone.

## Storing binary data

Document content is stored as UTF-8 strings.
Use a "file extension" on the end of your path to suggest how it should be interpreted: `.txt`?  `.json`?  `.html`?

Earthstar doesn't directly support storing raw binary data.
You can base64-encode your data, save it to Earthstar, and then base64-decode it when you load it back.

There's no way to tell if a document contains base64 data or not, so use the file extension to guess.  If it ends in `.jpg`, it's probably base64-encoded binary.

## Size limits

Browser localStorage is limited to 5 MB total.  If you're using that kind of storage, all of your documents across all your workspaces need to fit within 5 MB.

Browser IndexedDB can hold more data but it's not yet supported by Earthstar.

In node, SQLite can hold very large amounts of data.

Also, each document's content should be < 6 MB.  (And note that a binary file of 4.5 MB will grow to 6MB when base64-encoded.)  Larger documents should be broken into smaller pieces.

## Saving space

Deleted documents still take up about 300 bytes each.  If your app will generate and delete a lot of documents it can add up to a lot of clutter.

Example: a chat app where we don't need to keep very old history.

Here's 2 ways avoid clutter:

### 1. Re-use old paths

When writing a new message, look for an old one that's been deleted (from the same author), re-use that path and overwrite the old message.

### 2. Use ephemeral messages

Earthstar messages can have expiration dates.  They are deleted after that timestamp passes.  You can keep extending the expiration date to keep the document alive.

Read more in the [specification: ephemeral documents](https://github.com/earthstar-project/earthstar/blob/master/docs/specification.md#ephemeral-documents-deleteafter).

## Our final plan for data storage

```ts
/toboop/1606164670376000:7777777/text.txt     // content: a string
/toboop/1606164670376000:7777777/isDone.json  // content: true or false
```

## Put all that Todo code into a Layer

A set of code for handling a data format, such as Todos, is called a "Layer" in Earthstar.  Typically this is a single class that's treated like a React store, but there are no specific rules.

Here's the full Todo Layer from the Foyer app:

https://github.com/earthstar-project/earthstar-foyer/blob/master/src/layers/todoLayer.ts

# Making apps

## Kinds of apps

Here's 4 ways to make apps, from easy to hard:

1. A node command-line app, using the main `earthstar` package directly
2. A React app that uses the hooks from [react-earthstar](https://github.com/earthstar-project/react-earthstar/)
3. A React app that builds on top of [earthstar-foyer](https://github.com/earthstar-project/earthstar-foyer)
4. A frontend-based web app of any kind, using the main `earthstar` package directly
5. Native mobile or desktop apps

This tutorial uses #1, the node command-line app, because it's the simplest.

`react-earthstar` and `earthstar-foyer` have helpful UIs already built for adding and removing workspaces, logging in as a user, setting pubs, etc.

## Web apps

The usual structure of an Earthstar web app is:

* The backend is a simple static HTTP server.  It does no computation or storage of data.
* The frontend is a single-page application
* The frontend stores Earthstar data in localStorage or in memory
* The frontend syncs the data with pub server(s) over HTTP
* The frontend provides a UI for adding workspaces, changing pubs, making new user identities, etc.
* Sometimes the frontend contains multiple "apps" and you can switch between them from the same UI
* The user's keys never leave the browser
* Ideally the page is a [Progressive Web App](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps) that can be used offline, then sync'd later when the user comes back online.

You could also store the data in a more traditional backend and query it from the frontend.  This would be like a hybrid pub and app server.  We don't have an example of this style yet.  Make sure to keep the user's keys in the browser, have them sign documents there, and then upload the signed documents to the server.  The server should never have the user's keys.

## React

If you want to build on [earthstar-foyer](https://github.com/earthstar-project/earthstar-foyer), look in the `/src/apps/` folder and start by copying one of the existing apps.

Then add your new app to the dropdown menu in `/src/app.tsx`.

Foyer provides UI tabs for logging in, adding workspaces, etc.  Your app will appear beneath that UI.

---

If you want to use [react-earthstar](https://github.com/earthstar-project/react-earthstar/) which provides React hooks, most of the hooks are ready.  The UI for adding workspaces etc (the "Earthbar") is not quite finished but probably works; you may have to read the code and examples to get it working.

## Vue

Here's a very minimal demo of a Todo list built with Vue.

https://codesandbox.io/s/earthstar-vue-todo-list-demo-2-udv6o?file=/src/App.vue
