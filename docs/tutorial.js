let {
    OnePubOneWorkspaceSyncer,
    StorageMemory,
    StorageSqlite,
    ValidatorEs4,
    generateAuthorKeypair,
    isErr,
    sleep,
} = require('earthstar');

/*
You can also use import syntax:
    import {
        OnePubOneWorkspaceSyncer
        StorageMemory,
        // etc
    } from 'earthstar';
*/

//================================================================================
/*
Let's make a todo list app using Earthstar.

It'll run on the command line, in Node, but this code will also work in browsers.
This demo is plain Javascript, but Earthstar also works with Typescript.

Every computer running this app will keep its own complete copy of the data
so it can work when offline.
When online, they can sync with each other.

Our app will handle Todo objects like this...

    type Todo = {
        id: string,
        text: string,
        isDone: boolean,
    };

And we'll write some functions to save and load from that Todo format
to Earthstar.

ID GENERATION

Each Todo will have a unique id made from a timestamp plus some extra randomness
to avoid accidental collisions.
*/

let randInt = (lo, hi) =>
    // a random integer, inclusive of endpoints
    Math.floor(Math.random() * ((hi+1) - lo) + lo);

let generateTodoId = () =>
    // make an id like "1606164670376000:78987897"
    // Earthstar uses MICROseconds everywhere, not milliseconds,
    // so we multiply by 1000.
    `${Date.now() * 1000}:${randInt(10000000, 99999999)}`;

/*
PATHS

The atomic unit of storage in Earthstar is a "document".
It's similar to a file in a filesystem.
It has a "path" within its Earthstar workspace, and
some "content" which is a utf-8 string.

When there's a conflict in Earthstar, the documents aren't merged;
the most recent one wins.

So if we want users to be able to independenly update the text and isDone of a Todo,
we need to store --two-- Earthstar documents for each todo.

We also need to decide what paths to save our documents at,
and what the content will be.
*/

let todoTextPath = (id) =>
    `/toboop/${id}/text.txt`;     // will hold the text of the todo

let todoIsDonePath = (id) =>
    `/toboop/${id}/isDone.json`;  // will hold true or false (as a string)

/*
Why we chose those paths:
    * Always start with the name of the application
    * The app name is unique, not a common word like "todo" --
       we don't want to collide with other apps and their data.
    * The id is next, so that they conveniently sort in chronological order
    * We use "file extensions" as a hint about the kind of data in each doc

EDIT PERMISSIONS

By default, Earthstar documents can be edited and deleted by any user.

You can limit the edit permissions by including ("~" + author.address) in a path.
We don't use that feature in this tutorial, but it would look like this:

    `/toboop/~${author.address}/${id}/todo.txt`
    /toboop/~@suzy.bo6u3bozzjg4njjolt7eevdyws7dknjiuzjsmyg3winte6fbaktca/1606164670376000:78987897/todo.txt

The user address can appear anywhere in the path, at any depth of the folder hierarchy.
If a path has several addresses, any of those authors (and nobody else) can edit the document.
*/

//================================================================================
// SAVING AND LOADING TODO OBJECTS

// The basic Todo type used by our app
let makeNewTodo = (text, isDone) => {
    return {
        id: generateTodoId(),
        text: text,
        isDone: isDone,  // boolean
    }
}

let saveTodo = (storage, keypair, todo) => {
    // Given a Todo object, write it to two Earthstar documents (text and isDone).

    // "storage" is the Earthstar Storage instance.
    // "keypair" is an AuthorKeypair object holding the users public and private keys.

    // To save a document to Earthstar, we have to choose a document format.
    // "es.4" is the latest format at the moment.
    let write1 = storage.set(keypair, {
        format: 'es.4',
        path: todoTextPath(todo.id),
        content: todo.text,
    });
    let write2 = storage.set(keypair, {
        format: 'es.4',
        path: todoIsDonePath(todo.id),
        content: '' + todo.isDone,  // convert the boolean a string: "true" or "false"
    });

    // If the write fails for some reason it will return an Error (not throw -- return.)
    // isErr is a helper function that checks if something is an instanceOf Error.

    if (isErr(write1) || isErr(write2)) {
        console.warn('write failed', write1, write2);
    }
}

let listTodoIds = (storage) => {
    // Return an array of all the todo ids found in the Earthstar Storage.

    // Query for paths starting with "/toboop/".
    // That'll return both kinds of docs, the text.txt and isDone.json docs.
    // Let's filter them to only keep the text.txt docs.
    // Note that storage queries always return results sorted alphabetically by path,
    // so we don't have to sort it ourself.
    let query = { pathStartsWith: '/toboop/' };
    let labelPaths = storage.paths(query)
        .filter(path => path.endsWith('text.txt'));

    // Extract the todo id out of the path
    let ids = labelPaths.map(path => path.split('/')[2]);
    return ids;
};

let lookupTodo = (storage, id) => {
    // Given a todo id, look up both of its Earthstar documents
    // and combine them into a Todo object that our app knows how to handle.
    // Return undefined if not found.

    // Earthstar documents can sync slowly, and in any order, so we have to
    // be prepared for any of our documents to be missing -- we might not have
    // both documents for a Todo.

    // Look up documents by path and return their content,
    // or undefined if they're missing
    let textContent = storage.getContent(todoTextPath(id));
    let isDoneContent = storage.getContent(todoIsDonePath(id));

    // If the text document is missing, act like the entire todo doesn't exist.
    if (textContent === undefined) { return undefined; }

    // If the isDone document is missing, default it to false.
    let isDone = false;
    if (isDoneContent !== undefined) {
        // This is a ".json" document but it should only
        // ever hold "true" or "false", so we don't need
        // to actually JSON.parse it.
        isDone = (isDoneContent === 'true');
    }

    // Make a Todo style object for our app
    return {
        id: id,
        text: textContent,
        isDone: isDone,
    }
}

//================================================================================
// MAIN

/*
We're done making helper functions!  Let's actually set up our Earthstar storage
and start doing stuff.

WORKSPACE

A workspace is a collection of users and documents.
Just make up a workspace name to start using it.
Workspaces should have some randomness on the end to make them hard to guess,
because if you know the workspace you can get its data.
*/
let workspace = "+toboop.qo24jf9qo4f8hq4";

/*
STORAGE

Make the earthstar Storage class which will hold the documents of one workspace.

There are several storage backends to choose from.
You can use the in-memory storage which will be lost when the program ends...
*/
console.log('using memory storage');
let storage = new StorageMemory([ValidatorEs4], workspace);

/*
Or keep your data in an SQLite file.  SQLite only works in Node, not browsers.

There's also a command-line tool called "earthstar-cli" which can manage
sqlite files like this one and sync them for you.
https://www.npmjs.com/package/earthstar-cli

    let sqliteFilename = 'toboop.sqlite';
    console.log('using sqlite storage: ' + sqliteFilename);
    let storage = new StorageSqlite({
        mode: 'create-or-open',
        workspace: workspace,
        validators: [ValidatorEs4],
        filename: sqliteFilename
    });
*/

/*
Storage types:

                node        browsers

memory          yes         yes
sqlite          yes         -
localstorage    -           yes
indexeddb       -           coming soon
*/

/*
AUTHOR IDENTITY

In Earthstar, users are called Authors.
Each Author has a public and private key.

In the code we call these their "address" and "secret".
In user interfaces I like to call these "username" and "password"
to help people understand how they work.

Generate a new identity like this.
You can choose the first 4 letters of the address (called a "shortname").
The rest will be different every time you run it:

    let keypair = generateAuthorKeypair('suzy');
    console.log(keypair);

For this demo we'll use a hardcoded identity:
*/
let keypair = {
    address: "@suzy.bo6u3bozzjg4njjolt7eevdyws7dknjiuzjsmyg3winte6fbaktca",
    secret: "b2wmruovqhl4w6pbetozzvoh7zi4i66pdwwlsbfrmktk642w56ogq"
};


/*
ACTUALLY DO SOME STUFF WITH TODOS

Now we can make some Todos, save them to Earthstar, and load them back again.

You would probably want to build some command line flags to make this a useful
todo app -- maybe some flags to create, list, or complete todos.
*/

console.log('workspace:', workspace);
console.log('author:', keypair.address);
console.log();

let todos = [
    makeNewTodo('take a nap', false),
    makeNewTodo('go outside', false),
    makeNewTodo('feed the cat', true),
];

// save them to Earthstar
for (let todo of todos) {
    saveTodo(storage, keypair, todo);
}

// load them back and print them, to make sure it worked
console.log('Our todos after a roundtrip into Earthstar and back out again:');
let todoIds = listTodoIds(storage);
for (let id of todoIds) {
    let loadedTodo = lookupTodo(storage, id);
    console.log(loadedTodo);
}

// show the Earthstar document paths and contents
console.log();
console.log('Earthstar documents:');
for (let doc of storage.documents()) {
    console.log(
        '    path:', doc.path.padEnd(47, ' '),
        'content:', doc.content
    );
}

// show one raw Earthstar document in full detail
console.log();
console.log('One document in full detail:');
console.log(storage.documents()[0]);

//================================================================================
// SYNC

/*
Any two computers that can connect to each other can sync.
Eventually we'll allow direct p2p connections between users.
For now we're running "Pub servers" in the cloud because they're easier to connect to.

A pub is just another Earthstar peer with no special powers.
Its purpose is to keep your data online and to be easily reachable from anywhere.
You can sync a workspace with multiple pubs for redundancy.
Pubs can also serve a human-readable website for browsing your data.

Documents are signed by the author; pubs can read the data but
can't modify it.

For now, pubs just accept any data that's pushed to them, but it would be easy
to give them lists of allowed workspaces or users.

The sync protocol is just a couple of HTTP REST endpoints, using JSON data.

You can run a pub on your own computer:
> npm install --global earthstar-pub
> earthstar-pub --port 3333

You can also clone the demo pub on glitch.com (glitch calls this "remixing")
*/

let pub = "https://earthstar-demo-pub-v5-a.glitch.me";

// Make a Syncer instance.
// It's responsible for syncing one pub with one local workspace.
let syncer = new OnePubOneWorkspaceSyncer(storage, pub);

// You can "sync once" and then stop, or do a live sync that continues
// forever, streaming new changes as they happen.
// In this demo we'll just sync once.
let stillSyncing = false;
let syncOnce = async (pub) => {
    let stillSyncing = true;
    try {
        console.log(`syncing once to ${pub}...`);
        console.log('this might print a bunch of debug information...');

        let stats = await syncer.syncOnce()
        stillSyncing = false;

        console.log('done syncing');
        console.log(`visit ${pub}/workspace/${workspace} to see your docs on the pub.`);
        console.log(stats);  // show the number of docs that were synced
    } catch (err) {
        console.error(err);
    }
};
// uncomment these two lines to actually do the sync:
//stillSyncing = true;
//syncOnce();

/*
If you're not familiar with await/async, just know
that syncer.syncOnce() returns a Promise.  You could do this instead:

    syncer.syncOnce()
        .then((stats) => console.log('done syncing', stats));
*/

//================================================================================
// Extra credit: subscribing to changes

/*
If you're writing a web app you probably need to get notified when any
todos change in the storage (because of incoming data from a sync).

    let unsub = storage.onWrite(evt => {
        if (evt.isLocal) {
            // The write was caused by the local user.
            // Maybe we don't need to do anything in this case?
        } else {
            // The write came from the outside world, from a sync.
            // Do something with the new document,
            // maybe refresh the screen?
            let whatever = evt.document
        }
    });

    // Later, you can turn off this subscription:
    unsub();
*/

//================================================================================
// CLOSING

/*
When you're done with a Storage instance you must close it or your
program will hang forever.
This turns off subscriptions, closes files on disk, stops ongoing syncs, etc.
*/

// here's a function to wait until the syncing is done, then close it
let waitUntilSyncingIsDone = async() => {
    while (true) {
        console.log('                ...waiting for sync to finish');
        await sleep(240);
        if (stillSyncing === false) {
            console.log('                ...syncing is done; closing the storage and ending the program');
            storage.close();
            return;
        }
    }
}
if (stillSyncing) {
    waitUntilSyncingIsDone();
} else {
    // or we never tried to sync in the first place, let's just close it and be done
    storage.close();
}
