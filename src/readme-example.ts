import {
    StorageMemory,
    ValidatorEs4,
    generateAuthorKeypair,
    isErr,
} from './index';  // this import would normally be from 'earthstar';

// Create a database for a particular workspace, '+gardening.xxxxxxxx'
// We've chosen to use the latest 'es.4' feed format so we supply the matching validator.
let storage = new StorageMemory([ValidatorEs4], '+gardening.xxxxxxxx');

// Users are called "authors".
// Let's make up some authors for testing.
// A keypair is { address: '@aaaa.xxx', secret: 'xxx' }.
// (xxx represents base32-encoded ed25519 keys)
let keypair1 = generateAuthorKeypair('aaaa');
let keypair2 = generateAuthorKeypair('bbbb');
if (isErr(keypair1)) { throw "oops"; }  // error could happen if our author shortname broke the rules
if (isErr(keypair2)) { throw "oops"; }
let author1 = keypair1.address;
let author2 = keypair2.address;

// You can set documents at specific paths, like a filesystem or key-value store.
storage.set(keypair1, { format: 'es.4', path: '/wiki/Strawberry', content: 'Tasty' });
storage.getContent('/wiki/Strawberry'); // --> 'Tasty'

// One author can use multiple devices with no problems.
// Conflicts are resolved by timestamp.
// Here the same author overwrites their previous document,
// which is forgotten from the database.
storage.set(keypair1, { format: 'es.4', path: '/wiki/Strawberry', content: 'Tasty!!' });
storage.getContent('/wiki/Strawberry'); // --> 'Tasty!!'

// Multiple authors can overwrite each other (also by timestamp).
// Here author 2 writes to the same path.
storage.set(keypair2, { format: 'es.4', path: '/wiki/Strawberry', content: 'Yum' });
storage.getContent('wiki/Strawberry'); // --> 'Yum'

// Within a path we keep the most-recent document from each author,
// in case we need to do better conflict resolution later.
// To see the old versions, use a query:
storage.contents({ path: '/wiki/Strawberry', includeHistory: true });
// --> ['Yum', 'Tasty!!']  // newest first

// Get the entire document to see all the metadata as well as the content.
storage.getDocument('/wiki/Strawberry');
// --> {
//     format: 'es.4',
//     workspace: '+gardening.xxxxxxxx',
//     path: '/wiki/Strawberry',
//     content: 'Yum',
//     author: '@bbbb.xxxxxxx',
//     timestamp: 1596676583283000,  // time in microseconds: Date.now()*1000
//     signature: 'xxxxxxxx',
// }

// WRITE PERMISSIONS
//
// Paths can specify which authors are allowed to write to them.
// Author names in a path prefixed by '~' can write to that path.
//
// Examples:
// (in these docs, "xxx" is shorthand for a long public key)
// One author write permission:
//   '/about/~@aaaa.xxx/name'  -- only @aaaa.xxx can write here.
//   '/about/~@aaaa.xxx/follows/@bbbb.xxx'  -- only @aaaa.xxx can write here
// Public:
//   '/wall/@aaaa.xxx'  -- no tilde, so anyone can write here
//   '/wiki/Kittens'  -- no tilde, so anyone can write here
// Multiple authors:
//   '/whiteboard/~@aaaa.xxx~@bbbb.xxx'  -- both @aaaa.xxx and @bbbb.xxx can write here
//
// Here we'll set the author's display name by writing to their profile document.
storage.set(keypair1, {
    format: 'es.4',
    path: '/about/~' + keypair1.address + '/profile.json',
    content: JSON.stringify({longname: 'Suzie'}),
});

// You can do leveldb style queries.
storage.paths()
storage.paths({ lowPath: '/abc', limit: 100 })
storage.paths({ pathPrefix: '/wiki/' })

// You can sync to another Storage that has the same workspace address
let storage2 = new StorageMemory([ValidatorEs4], '+gardening.xxxxxxxx');
storage.sync(storage2);
// Now storage and storage2 are identical.

// Get notified when anything changes.
let unsub = storage.onChange.subscribe(() => console.log('something changed'));

// Later, you can turn off your subscription.
unsub();
