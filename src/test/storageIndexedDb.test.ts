import t = require('tap');

import { openDB, deleteDB, wrap, unwrap } from 'idb';

let log = console.log;
if (process.env['NODE']) {
    log('USING FAKE-INDEXEDDB');
    require('fake-indexeddb/auto');
}

interface MiniDoc {
    path: string,
    content: string,
    author: string,
    timestamp: number,
}

let choose = (arr: any[]) =>
    arr[Math.floor(Math.random() * arr.length)];

t.test('learning to use idb', async (t: any) => {
    console.log('\n-----------------------------------------------------\n');

    log('');
    log('making example doc');
    let doc: MiniDoc = {
        path: '/hello.txt',
        content: 'HELLO',
        author: '@a',
        timestamp: 345,
    };
    // this is the primary key for indexedDb, and it has to be unique.
    let docKey = (doc: MiniDoc) : string => {
        let reversedTimestamp = Number.MAX_SAFE_INTEGER - doc.timestamp;
        let paddedTimestamp = ('' + reversedTimestamp).padStart(17, '0');
        return `${doc.path}|${paddedTimestamp}|${doc.author}`;
    }
    let key = docKey(doc);
    log('doc:', doc);
    log('key:', key);


    log('');
    const DB_NAME = 'earthstar';
    const STORE_NAME = 'documents';
    const INDEX_TIMESTAMP = 'idx-timestamp';
    const INDEX_PATH = 'idx-path';
    const INDEX_AUTHOR = 'idx-author';
    log(`creating db "${DB_NAME}"`)
    let db = await openDB(DB_NAME, 1, {
        upgrade(db, oldVersion, newVersion) {
            log(`    upgrade from v ${oldVersion} to ${newVersion}`);
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                log(`    creating object store "${STORE_NAME}"`);
                let store = db.createObjectStore(STORE_NAME, { });
                store.createIndex(INDEX_TIMESTAMP, 'timestamp', { unique: false });
                store.createIndex(INDEX_PATH, 'path', { unique: false });
                store.createIndex(INDEX_AUTHOR, 'path', { unique: false });
            }
        }
    });
    log('...done creating db "earthstar"')


    log('');
    log('getting before it exists');
    log('    ', await db.get(STORE_NAME, key));

    log('putting');
    await db.put(STORE_NAME, doc, key);

    log('getting again');
    log('    ', await db.get(STORE_NAME, key));

    log('');
    log('writing many docs in a single transaction...');
    {
        log('    opening transaction');
        let tx = db.transaction(STORE_NAME, 'readwrite');
        log('    generating data');
        let timestamps = [100, 500, 300, 200, 400];
        let docs = timestamps.map((ts): MiniDoc => {
            return {
                path: '/iter.txt',
                content: 'TS=' + ts,
                author: choose(['@a', '@b', '@c']),
                timestamp: ts,
            }
        });
        log('    adding', timestamps);
        let proms: Promise<any>[] = docs.map(doc => tx.store.put(doc, docKey(doc)));
        log('    pushing done');
        proms.push(tx.done);
        log('    awaiting all promises');
        await Promise.all(proms);
        log('    completed');
    }

    log('');
    log('reading them all in key order');
    let docsInOrder = await db.getAll(STORE_NAME);
    for (let doc of docsInOrder) {
        console.log(doc);
    }

    log('');
    log('reading them all in date order (from index)');
    let docsInOrder2 = await db.getAllFromIndex(STORE_NAME, INDEX_TIMESTAMP);
    for (let doc of docsInOrder2) {
        console.log(doc);
    }

    log('');
    log('reading them all in path order (from index)');
    // when path is the same, it seems to use the primary key to set the order
    let docsInOrder3 = await db.getAllFromIndex(STORE_NAME, INDEX_PATH);
    for (let doc of docsInOrder3) {
        console.log(doc);
    }

    log('');
    log('reading from a cursor: timestamp between 300 and 400 inclusive, in reverse order');
    let cursor = await db.transaction(STORE_NAME).store.index(INDEX_TIMESTAMP)
        .openCursor(IDBKeyRange.bound(300, 400), 'prev'); // inclusive range
    while (cursor) {
        console.log(cursor.key, cursor.value);
        cursor = await cursor.continue();
    }

    log('');
    log('reading from a cursor: path in forwards order \'nextunique\'');
    // this gives us the highest-sorting document for each path
    // using the primary key to define the sort order
    let cursor2 = await db.transaction(STORE_NAME).store.index(INDEX_PATH)
        .openCursor(null, 'nextunique');
    while (cursor2) {
        console.log(cursor2.key, cursor2.value);
        cursor2 = await cursor2.continue();
    }

    // idb helpers:
    //   get getKey getAll getAllKeys
    //   count put add delete clear
    //   put: e.g. is upsert
    //   add: fails if already exists

    console.log('\n-----------------------------------------------------\n');

    t.pass();
    t.end();
    if (!process.env['NODE']) {
        window.close();
    }
});
