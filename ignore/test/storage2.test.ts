import * as fs from 'fs';
import t = require('tap');
//t.runOnly = true;

import {
    AuthorKeypair,
    Document,
    FormatName,
    IValidator,
    WriteResult,
    isErr,
    notErr,
    WriteEvent,
    ValidationError,
} from '../util/types';
import {
    generateAuthorKeypair,
    sha256base32,
} from '../crypto/crypto';
import { ValidatorEs4 } from '../validator/es4';

import {
    IStorage2,
} from '../storage2/types2';
import {
    Storage2, storage2Sync, storage2Push,
} from '../storage2/storage2';
import {
    DriverMemory,
} from '../storage2/driverMemory';
import {
    DriverSqlite,
} from '../storage2/driverSqlite';

//================================================================================
// prepare for test scenarios

let WORKSPACE = '+gardenclub.xxxxxxxxxxxxxxxxxxxx';
let WORKSPACE2 = '+another.xxxxxxxxxxxxxxxxxxxx';

let VALIDATORS : IValidator[] = [ValidatorEs4];
let FORMAT : FormatName = VALIDATORS[0].format;

let keypair1 = generateAuthorKeypair('test') as AuthorKeypair;
let keypair2 = generateAuthorKeypair('twoo') as AuthorKeypair;
let keypair3 = generateAuthorKeypair('thre') as AuthorKeypair;
let keypair4 = generateAuthorKeypair('four') as AuthorKeypair;
if (isErr(keypair1)) { throw "oops"; }
if (isErr(keypair2)) { throw "oops"; }
if (isErr(keypair3)) { throw "oops"; }
if (isErr(keypair4)) { throw "oops"; }
let author1 = keypair1.address;
let author2 = keypair2.address;
let author3 = keypair3.address;
let author4 = keypair4.address;
let now = 1500000000000000;

let SEC = 1000000;
let MIN = SEC * 60;
let HOUR = MIN * 60;
let DAY = HOUR * 24;

interface Scenario {
    makeStorage: (workspace : string) => IStorage2,
    description: string,
}
let scenarios : Scenario[] = [
    {
        makeStorage: (workspace : string) : IStorage2 => {
            let storage = new Storage2(new DriverMemory(), VALIDATORS, workspace);
            storage._now = now;
            return storage;
        },
        description: 'Storage2 DriverMemory',
    },
    //{
    //    makeStorage: (workspace : string) : IStorage2 => {
    //        let storage = new Storage2(new DriverSqlite(), VALIDATORS, workspace);
    //        storage._now = now;
    //        return storage;
    //    },
    //    description: 'Storage2 DriverSqlite',
    //},
];

//================================================================================
// constructor tests

t.test(`Storage2: constructor`, (t: any) => {
    t.throws(() => new Storage2(new DriverMemory(), [], WORKSPACE), 'throws when no validators are provided');
    t.throws(() => new Storage2(new DriverMemory(), VALIDATORS, 'bad-workspace-address'), 'throws when workspace address is invalid');
    t.end();
});


//================================================================================
// run the standard store tests on each scenario

for (let scenario of scenarios) {
    t.test(`==== starting test of ==== ${scenario.description}`, (t: any) => {
        t.end();
    });

    t.test(scenario.description + ': empty store', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);
        t.same(storage.authors(), [], 'no authors');
        t.same(storage.paths(), [], 'no paths');
        t.same(storage.documents(), [], 'no docs');
        t.same(storage.contents(), [], 'no contents');
        t.equal(storage.getDocument('xxx'), undefined, 'getDocument undefined');
        t.equal(storage.getDocument('xxx'), undefined, 'getContent undefined');
        t.end();
    });

    t.test(scenario.description + ': close', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        t.same(storage.isClosed(), false, 'starts off not closed');
        storage.close();
        t.same(storage.isClosed(), true, 'becomes closed');
        storage.close();
        t.same(storage.isClosed(), true, 'stays closed');

        t.throws(() => storage.authors(), 'contents() throws when closed');
        t.throws(() => storage.paths(), 'paths() throws when closed');
        t.throws(() => storage.documents(), 'documents() throws when closed');
        t.throws(() => storage.contents(), 'contents() throws when closed');
        t.throws(() => storage.getContent('/a'), 'latestContent() throws when closed');
        t.throws(() => storage.getDocument('/a'), 'latestDocument() throws when closed');
        t.throws(() => storage.ingestDocument({} as any, false), 'ingestDocument() throws when closed');
        t.throws(() => storage.set(keypair1, {} as any), 'set() throws when closed');
        t.end();
    });

    t.test(scenario.description + ': store ingestDocument rejects invalid docs', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        let doc1: Document = {
            format: FORMAT,
            workspace: WORKSPACE,
            path: '/k1',
            contentHash: sha256base32('v1'),
            content: 'v1',
            timestamp: now,
            deleteAfter: null,
            author: author1,
            signature: 'xxx',
        };
        let signedDoc = ValidatorEs4.signDocument(keypair1, doc1) as Document;
        t.ok(notErr(signedDoc), 'signature succeeded');
        t.same(storage.ingestDocument(signedDoc, false), WriteResult.Accepted, "successful ingestion");
        t.equal(storage.getContent('/k1'), 'v1', "latestContent worked");

        t.ok(isErr(storage.ingestDocument(doc1, false)), "don't ingest: bad signature");
        t.ok(isErr(storage.ingestDocument({...signedDoc, format: 'xxx'}, false)), "don't ingest: unknown format");
        t.ok(isErr(storage.ingestDocument({...signedDoc, timestamp: now / 1000}, false)), "don't ingest: timestamp too small, probably in milliseconds");
        t.ok(isErr(storage.ingestDocument({...signedDoc, timestamp: now * 2}, false)), "don't ingest: timestamp in future");
        t.ok(isErr(storage.ingestDocument({...signedDoc, timestamp: Number.MAX_SAFE_INTEGER * 2}, false)), "don't ingest: timestamp way too large");
        t.ok(isErr(storage.ingestDocument({...signedDoc, workspace: 'xxx'}, false)), "don't ingest: changed workspace after signing");

        let signedDocDifferentWorkspace = ValidatorEs4.signDocument(keypair1, {...doc1, workspace: '+nope.nope'}) as Document;
        t.ok(notErr(signedDocDifferentWorkspace), 'signature succeeded');
        t.ok(isErr(storage.ingestDocument(signedDocDifferentWorkspace, false)), "don't ingest: mismatched workspace");

        t.ok(isErr(storage.set(keypair1, {
            format: 'xxx',
            path: '/k1',
            content: 'v1',
        })), 'set rejects unknown format');

        let writablePaths = [
            '/hello',
            '/~' + author1 + '/about',
            '/chat/~@ffff.xxxx~' + author1,
        ];
        for (let path of writablePaths) {
            let signedDoc2 = ValidatorEs4.signDocument(keypair1, {...doc1, path: path});
            if (isErr(signedDoc2)) {
                t.ok(false, 'signature failed: ' + signedDoc2);
            } else {
                t.same(storage.ingestDocument(signedDoc2, false), WriteResult.Accepted, 'do ingest: writable path ' + path);
            }
        }
        let notWritablePaths = [
            '/~@ffff.bxxxx/about',
            '/~',
        ];
        let invalidPaths = [
            '',
            '/',
            'not-starting-with-slash',
            '/ending-with-slash/',
            '/has space',
            '/questionmark?',
        ];
        for (let path of notWritablePaths.concat(invalidPaths)) {
            let signedDoc2 = ValidatorEs4.signDocument(keypair1, {...doc1, path: path});
            if (isErr(signedDoc2)) {
                t.ok(false, 'signature failed: ' + signedDoc2);
            } else {
                t.ok(isErr(storage.ingestDocument(signedDoc2, false)), "don't ingest: non-writable or invalid path " + path);
            }
        }

        t.end();
    });

    t.test(scenario.description + ': deleteAfter', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        // an expired ephemeral doc can't be set because it's invalid
        t.ok(isErr(storage.set(keypair1, {
                format: FORMAT,
                path: '/path1!',
                content: 'aaa',
                timestamp: now - 60*MIN,
                deleteAfter: now - 45*MIN,
        })), 'set expired ephemeral document');
        t.equal(storage.getContent('/path1!'), undefined, 'temporary doc is not there');

        // a good doc.  make sure deleteAfter survives the roundtrip
        t.same(storage.set(keypair1, {
                format: FORMAT,
                path: '/ephemeral!',
                content: 'bbb',
                timestamp: now,
                deleteAfter: now + 3 * DAY,
        }), WriteResult.Accepted, 'set good ephemeral document');
        t.same(storage.set(keypair1, {
                format: FORMAT,
                path: '/regular',
                content: 'ccc',
                timestamp: now,
        }), WriteResult.Accepted, 'set good regular document');
        let ephDoc = storage.getDocument('/ephemeral!');
        let regDoc = storage.getDocument('/regular');

        if (ephDoc === undefined) {
            t.true(false, 'ephDoc was not set, or not retrieved');
        } else {
            t.true('deleteAfter' in (ephDoc as any), 'ephemeral doc has deleteAfter after roundtrip');
            t.equal(ephDoc?.deleteAfter, now + 3 * DAY, 'ephemeral doc deleteAfter value survived roundtrip');
        }
        if (regDoc === undefined) {
            t.true(false, 'regDoc was not set, or not retrieved');
        } else {
            t.equal(regDoc.deleteAfter, null, 'as expected, regular doc has deleteAfter: null');
        }

        // a doc that was valid when set, but expired while sitting in the database, then was read after being expired
        let setExpiringDoc = () => {
            t.same(storage.set(keypair1, {
                    format: FORMAT,
                    path: '/expire-in-place!',
                    content: 'ccc',
                    timestamp: now - 1,
                    deleteAfter: now + 5 * DAY,
            }), WriteResult.Accepted, 'set good ephemeral document');
        };

        if (false) {
            // optional behavior: delete expired docs when we encounter them.
            // it's sufficient to just ignore them, not delete them on the spot,
            // as long as they're eventually cleaned up.

            // set the doc, observe it in place.
            // set now ahead, try to get the doc, which should delete it.
            // rewind now again, and the doc should still be gone because it was deleted.
            setExpiringDoc();
            storage._now = now;
            t.notEqual(storage.getDocument('/expire-in-place!'), undefined, 'getDocument(): doc was there');
            storage._now = now + 8 * DAY;
            t.equal(   storage.getDocument('/expire-in-place!'), undefined, 'getDocument(): doc expired in place');
            storage._now = now;
            t.equal(   storage.getDocument('/expire-in-place!'), undefined, 'getDocument(): doc was deleted after expiring');

            setExpiringDoc();
            storage._now = now;
            t.equal(storage.getContent('/expire-in-place!'), 'ccc',     'getContent(): doc was there');
            storage._now = now + 8 * DAY;
            t.equal(storage.getContent('/expire-in-place!'), undefined, 'getContent(): doc expired in place');
            storage._now = now;
            t.equal(storage.getContent('/expire-in-place!'), undefined, 'getContent(): doc was deleted after expiring');

            setExpiringDoc();
            storage._now = now;
            t.same(storage.paths({pathPrefix: '/exp'}), ['/expire-in-place!'], 'paths(): doc was there');
            storage._now = now + 8 * DAY;
            t.same(storage.paths({pathPrefix: '/exp'}), [], 'paths(): doc expired in place');
            storage._now = now;
            t.same(storage.paths({pathPrefix: '/exp'}), [], 'paths(): doc was deleted after expiring');

            setExpiringDoc();
            storage._now = now;
            t.same(storage.documents({pathPrefix: '/exp'}).length, 1, 'documents(): doc was there');
            storage._now = now + 8 * DAY;
            t.same(storage.documents({pathPrefix: '/exp'}).length, 0, 'documents(): doc expired in place');
            storage._now = now;
            t.same(storage.documents({pathPrefix: '/exp'}).length, 0, 'documents(): doc was deleted after expiring');
        }

        // TODO for ephemeral doc tests:
        //
        // implement removal and result checking in sqlite and memory
        //
        // test includeHistory / isHead
        // test limit

        t.end();
    });


    t.test(scenario.description + ': basic one-author store', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        t.equal(storage.getContent('/path1'), undefined, 'nonexistant paths are undefined');
        t.equal(storage.getContent('/path2'), undefined, 'nonexistant paths are undefined');

        // set a decoy path to make sure the later tests return the correct path
        t.same(storage.set(keypair1, {format: FORMAT, path: '/decoy', content:'zzz', timestamp: now }), WriteResult.Accepted, 'set decoy path');

        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1.0', timestamp: now }), WriteResult.Accepted, 'set new path');
        t.equal(storage.getContent('/path1'), 'val1.0');

        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1.2', timestamp: now + 2 }), WriteResult.Accepted, 'overwrite path with newer time');
        t.equal(storage.getContent('/path1'), 'val1.2');

        // write with an old timestamp - this timestamp should be overridden to the existing timestamp + 1.
        // note that on ingest() the newer timestamp wins, but on set() we adjust the newly created timestamp
        // so it's always greater than the existing ones.
        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1.1', timestamp: now - 99 }), WriteResult.Ignored, 'do not supercede timestamp when providing one manually');
        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1.1' }), WriteResult.Accepted, 'automatically supercede previous timestamp');
        t.equal(storage.getContent('/path1'), 'val1.1', 'superceded newer existing content');
        t.equal(storage.getDocument('/path1')?.timestamp, now + 3, 'timestamp was superceded by 1 microsecond');

        // should be alphabetical
        t.same(storage.paths(), ['/decoy', '/path1'], 'paths() are correct');

        // order of contents should match order of paths
        t.same(storage.contents(), ['zzz', 'val1.1'], 'contents() are correct');

        t.same(storage.authors(), [author1], 'author');

        // returned document should have matching contentHash and content
        let doc = storage.getDocument('/path1');
        if (doc === undefined) { t.ok(false, 'this doc should not be undefined'); }
        else {
            t.notEqual(doc.content, null, 'content should not be null');
            t.equal(doc.contentHash, sha256base32(doc.content), 'doc.contentHash matches doc.content after roundtrip');
        }

        t.end();
    });

    t.test(scenario.description + ': path queries', (t: any) => {
        // TODO: test this with multiple docs per path
        let storage = scenario.makeStorage(WORKSPACE);
        let paths = '/zzz /aaa /dir /q /qq /qqq /dir/a /dir/b /dir/c'.split(' ');
        let ii = 0;
        for (let path of paths) {
            t.same(storage.set(keypair1, {format: FORMAT, path: path, content: 'true', timestamp: now + ii}), WriteResult.Accepted, 'set path: ' + path);
            ii += 1;
        }
        let sortedPaths = [...paths];
        sortedPaths.sort();
        let pathsFromStorage = storage.paths();
        t.same(paths.length, pathsFromStorage.length, 'same number of paths');
        t.same(sortedPaths, pathsFromStorage, 'paths are sorted');

        t.same(storage.paths({ path: '/q' }), ['/q'], 'query for specific path');
        t.same(storage.documents({ path: '/q' }).map(doc => doc.path), ['/q'], 'query for specific path (documents)');
        t.same(storage.paths({ path: '/nope' }), [], 'query for missing path');
        t.same(storage.documents({ path: '/nope' }), [], 'query for missing path (documents)');

        t.same(storage.paths({ pathPrefix: '/dir' }), ['/dir', '/dir/a', '/dir/b', '/dir/c'], 'pathPrefix');
        t.same(storage.paths({ pathPrefix: '/dir/' }), ['/dir/a', '/dir/b', '/dir/c'], 'pathPrefix');
        t.same(storage.paths({ pathPrefix: '/dir/', limit: 2 }), ['/dir/a', '/dir/b'], 'pathPrefix with limit');
        t.end();
    });

    t.test(scenario.description + ': contentIsEmpty queries', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        t.same(storage.set(keypair1, {format: FORMAT, path: '/full', content: 'full', timestamp: now}), WriteResult.Accepted, 'set /full to "full"');
        t.same(storage.set(keypair1, {format: FORMAT, path: '/empty', content: '', timestamp: now}), WriteResult.Accepted, 'set /empty to ""');
        t.same(storage.set(keypair1, {format: FORMAT, path: '/empty2', content: '', timestamp: now}), WriteResult.Accepted, 'set /empty2 to ""');

        t.same(storage.getDocument('/full')?.content, 'full', 'full getDocument.content = "full"');
        t.same(storage.getContent('/full'), 'full', 'full getContent = "full" ');
        t.same(storage.getDocument('/empty')?.content, '', 'empty getDocument.content = ""');
        t.same(storage.getContent('/empty'), '', 'empty getContent = ""');

        t.same(storage.documents().length, 3, 'documents() length = 3')
        t.same(storage.paths().length, 3, 'paths() length = 3')
        t.same(storage.contents().length, 3, 'contents() length = 3')

        t.same(storage.documents({ contentSize_gt: 0 }).length, 1, 'documents(contentSize_gt: 0) length = 1')
        t.same(storage.paths(    { contentSize_gt: 0 }).length, 1, 'paths(contentSize_gt: 0) length = 1')
        t.same(storage.contents( { contentSize_gt: 0 }).length, 1, 'contents(contentSize_gt: 0) length = 1')

        t.same(storage.documents({ contentSize: 0 }).length, 2, 'documents(contentSize: 0) length = 2')
        t.same(storage.paths(    { contentSize: 0 }).length, 2, 'paths(contentSize: 0) length = 2')
        t.same(storage.contents( { contentSize: 0 }).length, 2, 'contents(contentSize: 0) length = 2')

        // overwrite full with empty, and vice versa
        t.same(storage.set(keypair2, {format: FORMAT, path: '/full',  content: '',  timestamp: now + 2 }), WriteResult.Accepted, 'set /full to "" using author 2');
        t.same(storage.set(keypair2, {format: FORMAT, path: '/empty', content: 'e', timestamp: now + 2 }), WriteResult.Accepted, 'set /empty to "e" using author 2');

        t.same(storage.getDocument('/full')?.content, '', 'full getDocument.content = ""');
        t.same(storage.getContent('/full'), '', 'full getContent = "" ');
        t.same(storage.getDocument('/empty')?.content, 'e', 'empty getDocument.content = "e"');
        t.same(storage.getContent('/empty'), 'e', 'empty getContent = "e"');

        // combine path and contentSize queries
        // note there are now two docs for each path.

        // the lastest in /full has no content (we changed it, above)
        t.same(storage.documents({ isHead: true, path: '/full'                    }).length, 1, 'documents({ isHead: true, path: /full,                   }) length = 1')
        t.same(storage.documents({ isHead: true, path: '/full', contentSize_gt: 0 }).length, 0, 'documents({ isHead: true, path: /full, contentSize_gt: 0 }) length = 0')
        t.same(storage.documents({ isHead: true, path: '/full', contentSize: 0    }).length, 1, 'documents({ isHead: true, path: /full, contentSize: 0    }) length = 1')

        // in /full there's two docs: one has content '' and one has 'full'
        t.same(storage.documents({               path: '/full'                    }).length, 2, 'documents({               path: /full,                   }) length = 2')
        t.same(storage.documents({               path: '/full', contentSize_gt: 0 }).length, 1, 'documents({               path: /full, contentSize_gt: 0 }) length = 1')
        t.same(storage.documents({               path: '/full', contentSize: 0    }).length, 1, 'documents({               path: /full, contentSize: 0    }) length = 1')

        // the lastest in /empty has content 'e'
        t.same(storage.documents({ isHead: true, path: '/empty'                    }).length, 1, 'documents({ isHead: true, path: /empty,                   }) length = 1')
        t.same(storage.documents({ isHead: true, path: '/empty', contentSize_gt: 0 }).length, 1, 'documents({ isHead: true, path: /empty, contentSize_gt: 0 }) length = 1')
        t.same(storage.documents({ isHead: true, path: '/empty', contentSize: 0    }).length, 0, 'documents({ isHead: true, path: /empty, contentSize: 0    }) length = 0')

        // in /empty there's two docs: one has content '' and one has 'full'
        t.same(storage.documents({               path: '/empty'                    }).length, 2, 'documents({               path: /empty,                   }) length = 2')
        t.same(storage.documents({               path: '/empty', contentSize_gt: 0 }).length, 1, 'documents({               path: /empty, contentSize_gt: 0 }) length = 1')
        t.same(storage.documents({               path: '/empty', contentSize: 0    }).length, 1, 'documents({               path: /empty, contentSize: 0    }) length = 1')

        t.end();
    });

    t.test(scenario.description + ': limits on queries', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        // three authors
        t.same(storage.set(keypair1, {format: FORMAT, path: '/foo', content: 'foo', timestamp: now}), WriteResult.Accepted, 'set data');
        t.same(storage.set(keypair1, {format: FORMAT, path: '/pathA', content: 'content1', timestamp: now + 1}), WriteResult.Accepted, 'set data');
        t.same(storage.set(keypair2, {format: FORMAT, path: '/pathA', content: 'content2', timestamp: now + 2}), WriteResult.Accepted, 'set data');
        t.same(storage.set(keypair3, {format: FORMAT, path: '/pathA', content: 'content3', timestamp: now + 3}), WriteResult.Accepted, 'set data');

        t.same(storage.authors(), [author1, author3, author2], 'authors');

        // queries with limits
        // including all history
        t.same(storage.paths(   {}), ['/foo', '/pathA'], 'paths with history, no limit');
        t.same(storage.contents({}), ['foo', 'content3', 'content2', 'content1'], 'contents with history, no limit');

        t.same(storage.paths(   { limit: 1 }), ['/foo'], 'paths with history, limit 1');
        t.same(storage.contents({ limit: 1 }), ['foo'], 'contents with history, limit 1');

        t.same(storage.paths(   { limit: 2 }), ['/foo', '/pathA'], 'paths with history, limit 2');
        t.same(storage.contents({ limit: 2 }), ['foo', 'content3'], 'contents with history, limit 2');

        t.same(storage.paths(   { limit: 3 }), ['/foo', '/pathA'], 'paths with history, limit 3');
        t.same(storage.contents({ limit: 3 }), ['foo', 'content3', 'content2'], 'contents with history, limit 3');
        
        // no history, just heads
        t.same(storage.paths(   { isHead: true }), ['/foo', '/pathA'], 'paths no history, no limit');
        t.same(storage.contents({ isHead: true }), ['foo', 'content3'], 'contents no history, no limit');

        t.same(storage.paths(   { isHead: true, limit: 1 }), ['/foo'], 'paths no history, limit 1');
        t.same(storage.contents({ isHead: true, limit: 1 }), ['foo'], 'contents no history, limit 1');

        t.end();
    });

    t.test(scenario.description + ': path and author queries', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        // two authors
        t.same(storage.set(keypair1, {format: FORMAT, path: '/pathA', content: 'content1.X', timestamp: now + 1}), WriteResult.Accepted, 'set data');
        t.same(storage.set(keypair2, {format: FORMAT, path: '/pathA', content: 'content2.Y', timestamp: now + 2}), WriteResult.Accepted, 'set data');
        t.same(storage.set(keypair1, {format: FORMAT, path: '/pathA', content: 'content1.Z', timestamp: now + 3}), WriteResult.Accepted, 'set data');

        t.same(storage.authors(), [author1, author2], 'authors');

        // path queries
        t.same(storage.paths(    { path: '/pathA', isHead: true }), ['/pathA'], 'paths with path query');
        t.same(storage.contents( { path: '/pathA', isHead: true }), ['content1.Z'], 'contents with path query');
        t.same(storage.documents({ path: '/pathA', isHead: true }).map(d => d.content), ['content1.Z'], 'documents with path query');

        t.same(storage.paths(    { path: '/pathA',  }), ['/pathA'], 'paths with path query, history');
        t.same(storage.contents( { path: '/pathA',  }), ['content1.Z', 'content2.Y'], 'contents with path query, history');
        t.same(storage.documents({ path: '/pathA',  }).map(d => d.content), ['content1.Z', 'content2.Y'], 'documents with path query, history');

        // author
        t.same(storage.paths({ author: author1               }), ['/pathA'], 'paths author 1, history');
        t.same(storage.paths({ author: author1, isHead: true }), ['/pathA'], 'paths author 1, no history');
        t.same(storage.paths({ author: author2               }), ['/pathA'], 'paths author 2, history');
        t.same(storage.paths({ author: author2, isHead: true }), [], 'paths author 2, no history');
        t.same(storage.contents({ author: author1               }), ['content1.Z'], 'contents author 1, history');
        t.same(storage.contents({ author: author1, isHead: true }), ['content1.Z'], 'contents author 1, no history');
        t.same(storage.contents({ author: author2               }), ['content2.Y'], 'contents author 2, history');
        t.same(storage.contents({ author: author2, isHead: true }), [], 'contents author 2, no history');
        t.same(storage.documents({ author: author1               }).length, 1, 'documents author 1, history');
        t.same(storage.documents({ author: author1, isHead: true }).length, 1, 'documents author 1, no history');
        t.same(storage.documents({ author: author2               }).length, 1, 'documents author 2, history');
        t.same(storage.documents({ author: author2, isHead: true }).length, 0, 'documents author 2, no history');

        //// participatingAuthor
        //// TODO: this has been removed from the latest query options
        //t.same(storage.contents({ participatingAuthor: author1, includeHistory: true }), ['content1.Z', 'content2.Y'], 'participatingAuthor 1, with history');
        //t.same(storage.contents({ participatingAuthor: author1, includeHistory: false }), ['content1.Z'], 'participatingAuthor 1, no history');
        //t.same(storage.contents({ participatingAuthor: author2, includeHistory: true }), ['content1.Z', 'content2.Y'], 'participatingAuthor 2, with history');
        //t.same(storage.contents({ participatingAuthor: author2, includeHistory: false }), ['content1.Z'], 'participatingAuthor 2, no history');

        t.end();
    });

    t.test(scenario.description + ': multi-author writes', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

       // set decoy paths to make sure the later tests return the correct path
        t.same(storage.set(keypair1, {format: FORMAT, path: '/decoy2', content: 'zzz', timestamp: now}), WriteResult.Accepted, 'set decoy path 2');
        t.same(storage.set(keypair1, {format: FORMAT, path: '/decoy1', content: 'aaa', timestamp: now}), WriteResult.Accepted, 'set decoy path 1');

        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'one', timestamp: now}), WriteResult.Accepted, 'set new path');
        t.equal(storage.getContent('/path1'), 'one');

        // this will overwrite 'one' but the doc for 'one' will remain in history.
        // history will have 2 docs for this path.
        t.same(storage.set(keypair2, {format: FORMAT, path: '/path1', content: 'two', timestamp: now + 1}), WriteResult.Accepted, 'update from a second author');
        t.equal(storage.getContent('/path1'), 'two');

        // this will replace the old original doc 'one' from this author.
        // history will have 2 docs for this path.
        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'three', timestamp: now + 2}), WriteResult.Accepted, 'update from original author again');
        t.equal(storage.getContent('/path1'), 'three');

        t.equal(storage.paths().length, 3, '3 paths');
        t.equal(storage.contents({ isHead: true }).length, 3, '3 contents with just heads');
        t.equal(storage.contents().length, 4, '4 contents with history');

        t.same(storage.paths(), ['/decoy1', '/decoy2', '/path1'], 'paths()');
        t.same(storage.contents({ isHead: true }), ['aaa', 'zzz', 'three'], 'contents() with just heads');
        t.same(storage.contents(), ['aaa', 'zzz', 'three', 'two'], 'contents with history, newest first');

        t.same(
            storage.documents().map((doc : Document) => doc.author),
            [author1, author1, author1, author2],
            'docs with history, newest first, docs should have correct authors'
        );

        let sortedAuthors = [author1, author2];
        sortedAuthors.sort();
        t.same(storage.authors(), sortedAuthors, 'authors');

        // TODO: test sorting of docs with 2 authors, same timestamps, different signatures

        t.end();
    });

    t.test(scenario.description + ': sync: push to empty store', (t: any) => {
        let storage1 = scenario.makeStorage(WORKSPACE);
        let storage2 = scenario.makeStorage(WORKSPACE);

        // set up some paths
        t.same(storage1.set(keypair1, {format: FORMAT, path: '/decoy2', content: 'zzz', timestamp: now}), WriteResult.Accepted, 'author1 set decoy path');
        t.same(storage1.set(keypair1, {format: FORMAT, path: '/decoy1', content: 'aaa', timestamp: now}), WriteResult.Accepted, 'author1 set decoy path');
        t.same(storage1.set(keypair1, {format: FORMAT, path: '/path1', content: 'one', timestamp: now}), WriteResult.Accepted, 'author1 set path1');
        t.same(storage1.set(keypair2, {format: FORMAT, path: '/path1', content: 'two', timestamp: now + 1}), WriteResult.Accepted, 'author2 set path1');

        // sync
        let syncResults = storage2Sync(storage1, storage2);
        t.same(syncResults, { numPushed: 4, numPulled: 0 }, 'pushed 4 docs (includes history docs).  pulled 0.');

        // check results
        t.same(storage1.paths(), storage2.paths(), 'storage1.paths() == storage2.paths()');
        t.same(storage1.contents({ isHead: true }), storage2.contents({ isHead: true }), 'storage1 contents == storage2 (heads only)');
        t.same(storage1.contents(), storage2.contents(), 'storage1 contents with history == storage2');

        t.same(storage2.paths(), ['/decoy1', '/decoy2', '/path1'], 'paths are as expected');
        t.same(storage2.getContent('/path1'), 'two', 'latest doc for a path wins on storage2');
        t.same(storage2.getDocument('/path1')?.content, 'two', 'getDocument has correct content');
        t.same(storage2.contents({ isHead: true }), ['aaa', 'zzz', 'two'], 'storage2 contents are as expected (heads only)');
        t.same(storage2.contents(), ['aaa', 'zzz', 'two', 'one'], 'contents with history are as expected');

        // sync again.  nothing should happen.
        let syncResults2 = storage2Sync(storage1, storage2);
        t.same(syncResults2, { numPushed: 0, numPulled: 0 }, 'nothing happens if syncing again');

        t.end();
    });

    t.test(scenario.description + ': sync: two-way', (t: any) => {
        let storage1 = scenario.makeStorage(WORKSPACE);
        let storage2 = scenario.makeStorage(WORKSPACE);

        // set up some paths
        t.same(storage1.set(keypair1, {format: FORMAT, path: '/decoy2', content: 'zzz', timestamp: now}), WriteResult.Accepted, 'author1 set decoy path');  // winner  (push #1)
        t.same(storage1.set(keypair1, {format: FORMAT, path: '/decoy1', content: 'aaa', timestamp: now}), WriteResult.Accepted, 'author1 set decoy path');  // winner  (push 2)

        t.same(storage1.set(keypair1, {format: FORMAT, path: '/path1', content: 'one', timestamp: now}), WriteResult.Accepted, 'author1 set path1');      // becomes history  (push 3)
        t.same(storage1.set(keypair2, {format: FORMAT, path: '/path1', content: 'two', timestamp: now + 1}), WriteResult.Accepted, 'author2 set path1');  // winner  (push 4)

        t.same(storage2.set(keypair1, {format: FORMAT, path: '/latestOnStorage1', content: '221', timestamp: now}), WriteResult.Accepted);       // dropped
        t.same(storage1.set(keypair1, {format: FORMAT, path: '/latestOnStorage1', content: '111', timestamp: now + 10}), WriteResult.Accepted);  // winner  (push 5)

        t.same(storage1.set(keypair1, {format: FORMAT, path: '/latestOnStorage2', content: '11', timestamp: now}), WriteResult.Accepted);       // dropped
        t.same(storage2.set(keypair1, {format: FORMAT, path: '/latestOnStorage2', content: '22', timestamp: now + 10}), WriteResult.Accepted);  // winner  (pull 1)

        t.same(storage1.set(keypair1, {format: FORMAT, path: '/authorConflict', content: 'author1storage1', timestamp: now}), WriteResult.Accepted);      // becomes history  (push 6)
        t.same(storage2.set(keypair2, {format: FORMAT, path: '/authorConflict', content: 'author2storage2', timestamp: now + 1}), WriteResult.Accepted);  // winner  (pull 2)

        // sync
        let syncResults = storage2Sync(storage1, storage2);
        t.same(syncResults, { numPushed: 6, numPulled: 2 }, 'pushed 6 docs, pulled 2 (including history)');

        t.equal(storage1.paths().length, 6, '6 paths');
        t.equal(storage1.documents({ isHead: true }).length, 6, '6 docs, heads only');
        t.equal(storage1.documents().length, 8, '8 docs with history');
        t.equal(storage1.contents({ isHead: true }).length, 6, '6 contents, heads only');
        t.equal(storage1.contents().length, 8, '8 contents with history');

        t.same(storage1.paths(), '/authorConflict /decoy1 /decoy2 /latestOnStorage1 /latestOnStorage2 /path1'.split(' '), 'correct paths on storage1');
        t.same(storage1.contents({ isHead: true }), 'author2storage2 aaa zzz 111 22 two'.split(' '), 'correct contents on storage1');

        t.same(storage1.paths(), storage2.paths(), 'paths match');
        t.same(storage1.documents({ isHead: true }), storage2.documents({ isHead: true }), 'docs match, heads only');
        t.same(storage1.documents(), storage2.documents(), 'docs with history: match');
        t.same(storage1.contents({ isHead: true }), storage2.contents({ isHead: true }), 'contents match, heads only');
        t.same(storage1.contents(), storage2.contents(), 'contents with history: match');

        t.end();
    });

    t.test(scenario.description + ': sync: mismatched workspaces', (t: any) => {
        let storageA1 = scenario.makeStorage(WORKSPACE);
        let storageA2 = scenario.makeStorage(WORKSPACE);
        let storageB = scenario.makeStorage(WORKSPACE2);
        t.same(storageA1.set(keypair1, {format: FORMAT, path: '/a1', content: 'a1'}), WriteResult.Accepted);
        t.same(storageA2.set(keypair1, {format: FORMAT, path: '/a2', content: 'a2'}), WriteResult.Accepted);
        t.same(storageB.set(keypair1, {format: FORMAT, path: '/b', content: 'b'}), WriteResult.Accepted);

        t.same(storage2Sync(storageA1, storageB),  { numPulled: 0, numPushed: 0}, 'sync across different workspaces should do nothing');
        t.same(storage2Sync(storageA1, storageA2), { numPulled: 1, numPushed: 1}, 'sync across matching workspaces should do something');

        t.end();
    });

    t.test(scenario.description + ': sync: misc other options', (t: any) => {
        let storageEmpty1 = scenario.makeStorage(WORKSPACE);
        let storageEmpty2 = scenario.makeStorage(WORKSPACE);
        let storageEmpty3 = scenario.makeStorage(WORKSPACE);
        let storage = scenario.makeStorage(WORKSPACE);

        t.same(storage.set(keypair1, {format: FORMAT, path: '/foo', content: 'bar'}), WriteResult.Accepted);

        // sync with empty stores
        t.same(storage2Sync( storageEmpty1, storageEmpty2), { numPushed: 0, numPulled: 0 }, 'sync with empty stores');
        t.same(storage2Push( storageEmpty1, storageEmpty2), 0, 'push with empty stores');
        t.same(storage2Push( storageEmpty1, storage      ), 0, 'push from empty to full store');

        // sync with self
        t.same(storage2Sync(storage, storage), { numPushed: 0, numPulled: 0 }, 'sync with self should do nothing');

        // successful sync
        t.same(storage2Sync(storage, storageEmpty1), { numPushed: 1, numPulled: 0 }, 'successful sync (push)');
        t.same(storage2Sync(storageEmpty2, storage), { numPushed: 0, numPulled: 1 }, 'successful sync (pull)');

        t.same(storage2Push(storage, storageEmpty3), 1, 'successful push');

        t.end();
    });

    t.test(scenario.description + ': onChange', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        let numCalled = 0;
        let unsub = storage.onWrite.subscribe(() => { numCalled += 1 });

        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1.0', timestamp: now}), WriteResult.Accepted, 'set new path');
        t.ok(isErr(storage.set(keypair1, {format: 'xxx', path: '/path1', content: 'val1.1', timestamp: now})), 'invalid set that will be ignored');
        t.equal(storage.getContent('/path1'), 'val1.0', 'second set was ignored');

        t.equal(numCalled, 1, 'callback was called once');
        unsub();

        t.same(storage.set(keypair1, {format: FORMAT, path: '/path2', content: 'val2.0', timestamp: now + 1}), WriteResult.Accepted, 'set another path');

        t.equal(numCalled, 1, 'callback was not called after unsubscribing');

        t.end();
    });

    t.test(scenario.description + ': onWrite', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);
        let storage2 = scenario.makeStorage(WORKSPACE);
        let storage3 = scenario.makeStorage(WORKSPACE);
        let storage4 = scenario.makeStorage(WORKSPACE);

        let events: WriteEvent[] = [];
        let unsub = storage.onWrite.subscribe((e) => { events.push(e) });

        // set new path
        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1+1', timestamp: now + 1}), WriteResult.Accepted, '=== set new path from keypair1');
        t.same(events[events.length-1].document.content, 'val1+1');
        t.same(events[events.length-1].isLocal, true, 'event is local');
        t.same(events[events.length-1].isLatest, true, 'event is latest');

        // overwrite from same author
        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1+2', timestamp: now + 2}), WriteResult.Accepted, '=== update same path from keypair1');
        t.same(events[events.length-1].document.content, 'val1+2');
        t.same(events[events.length-1].isLocal, true, 'event is local');
        t.same(events[events.length-1].isLatest, true, 'event is latest');

        // overwrite from a new author
        t.same(storage.set(keypair2, {format: FORMAT, path: '/path1', content: 'val2+3', timestamp: now + 3}), WriteResult.Accepted, '=== update same path from keypair2');
        t.same(events[events.length-1].document.content, 'val2+3');
        t.same(events[events.length-1].isLocal, true, 'event is local');
        t.same(events[events.length-1].isLatest, true, 'event is latest');

        // old write from same author, synced and ignored
        t.same(storage2.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1-9', timestamp: now - 9}), WriteResult.Accepted, '=== old write from keypair1, synced');
        storage2Push(storage2, storage);
        t.same(events.length, 3, 'no event happens because nothing happened in the sync');
        t.same(storage.getContent('/path1'), 'val2+3', 'content is unchanged');

        // new write from same author, synced and used
        t.same(storage3.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1+9', timestamp: now + 9}), WriteResult.Accepted, '=== new write from same author, synced');
        storage2Push(storage3, storage);
        t.same(events.length, 4, 'sync caused an event');
        t.same(storage.getContent('/path1'), 'val1+9', 'content changed after a sync');
        t.same(events[events.length-1].document.content, 'val1+9', 'event has corrent content');
        t.same(events[events.length-1].isLocal, false, 'event is not local (it came from a sync)');
        t.same(events[events.length-1].isLatest, true, 'event is latest');

        // a write from keypair2 which is synced but not a head
        // (it's a new latest doc for keypair2, but not a new latest doc overall for this path)
        t.same(storage4.set(keypair2, {format: FORMAT, path: '/path1', content: 'val2+5', timestamp: now + 5}), WriteResult.Accepted, '=== a write into history, synced');
        let numSynced = storage2Push(storage4, storage);
        t.same(numSynced, 1, 'it was synced');
        t.same(storage.getContent('/path1'), 'val1+9', '(latest) content did not change');
        t.same(events.length, 5, 'an event happens');
        t.same(events[events.length-1].document.content, 'val2+5', 'event has correct content');
        t.same(events[events.length-1].isLocal, false, 'event is not local (it came from a sync)');
        t.same(events[events.length-1].isLatest, false, 'event is not latest');

        // unsubscribe
        let prevLen = events.length;
        unsub();
        t.same(storage.set(keypair1, {format: FORMAT, path: '/z', content: 'foo'}), WriteResult.Accepted, 'do a write after unsubscribing');
        t.same(events.length, prevLen, 'no event happens after unsubscribing');

        t.end();
    });

    t.test(scenario.description + ': doc immutability', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);
        let storage2 = scenario.makeStorage(WORKSPACE);

        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1.0', timestamp: now}), WriteResult.Accepted, 'set new path');
        let doc = storage.getDocument('/path1');
        if (doc === undefined) {
            t.true(false, '???');
            t.end();
            return;
        }
        t.true(Object.isFrozen(doc), 'getDocument: returned doc is frozen');
        let docs = storage.documents();
        for (let doc of docs) {
            t.true(Object.isFrozen(doc), 'documents: returned doc is frozen');
        }

        let inputDoc = {...doc};
        t.false(Object.isFrozen(inputDoc), 'input doc is not frozen');
        storage2.ingestDocument(inputDoc, true);
        t.true(Object.isFrozen(inputDoc), 'input doc is now frozen after being ingested');

        t.end();
    });

    t.test(scenario.description + ': set(): manual vs default (bumped) timestamps & bounds-checking timestamps', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        // default timestamps
        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'default now'                       }), WriteResult.Accepted, 'absent timestamp: now');
        t.same(storage.getDocument('/path1')?.timestamp, now, '= now');
        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'default now'                       }), WriteResult.Accepted, 'absent timestamp: bumped');
        t.same(storage.getDocument('/path1')?.timestamp, now + 1, '= now + 1');
        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'default now', timestamp: 0         }), WriteResult.Accepted, 'zero timestamp: bumped');
        t.same(storage.getDocument('/path1')?.timestamp, now + 2, '= now + 2');
        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'default now', timestamp: undefined }), WriteResult.Accepted, 'undefined timestamp: bumped');
        t.same(storage.getDocument('/path1')?.timestamp, now + 3, '= now + 3');

        // manual timestamps
        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'manual now-10', timestamp: now - 10}), WriteResult.Ignored, 'manual timestamp in past from same author is ignored');

        t.same(storage.set(keypair2, {format: FORMAT, path: '/path1', content: 'manual now-10', timestamp: now - 10}), WriteResult.Accepted, 'manual timestamp in past');
        t.same(storage.documents({ author: keypair2.address })[0].timestamp, now - 10, '= now - 10');

        t.same(storage.set(keypair3, {format: FORMAT, path: '/path1', content: 'manual now+10', timestamp: now + 10}), WriteResult.Accepted, 'manual timestamp in future');
        t.same(storage.documents({ author: keypair3.address })[0].timestamp, now + 10, '= now + 10');

        // invalid timestamps
        t.ok(storage.set(keypair4, {format: FORMAT, path: '/path1', content: 'milliseconds', timestamp: Date.now() })
            instanceof ValidationError, 'millisecond timestamp: rejected');
        t.ok(storage.set(keypair4, {format: FORMAT, path: '/path1', content: 'milliseconds', deleteAfter: Date.now() })
            instanceof ValidationError, 'millisecond deleteAfter: rejected');
        t.ok(storage.set(keypair4, {format: FORMAT, path: '/path1', content: 'milliseconds', timestamp: now, deleteAfter: now - 5 })
            instanceof ValidationError, 'deleteAfter and timestamp out of order: rejected');

        t.end();
    });

    t.test(scenario.description + ': set(): invalid keypair causes error', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        let keypairBad: AuthorKeypair = {
            address: 'bad address',
            secret: keypair1.secret,
        }
        let result = storage.set(keypairBad, {format: FORMAT, path: '/path1', content: 'hello'});
        t.ok(result instanceof ValidationError, 'set with invalid keypair causes ValidationError');

        let result2 = storage.set(keypair1, {format: FORMAT, path: 'invalid path', content: 'hello'});
        t.ok(result2 instanceof ValidationError, 'set with invalid path causes ValidationError');

        let result3 = storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'hello', timestamp: 3});
        t.ok(result3 instanceof ValidationError, 'set with invalid timestamp causes ValidationError');

        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'hello'}), WriteResult.Accepted, 'write a valid document');
        let result4 = storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'hello', timestamp: 3});
        t.ok(result4 instanceof ValidationError, 'set with invalid timestamp causes ValidationError even if a good document exists');

        t.end();
    });

    t.test(scenario.description + ': set(): without now override', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);
        storage._now = null;

        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'hello'}), WriteResult.Accepted, 'write a valid document');
        let doc = storage.getDocument('/path1');
        if (doc === undefined) {
            t.true(false, '???');
            t.end();
            return;
        }
        let offset = Math.abs((Date.now() * 1000) - doc.timestamp);
        t.ok(offset < 200 * 1000, 'doc timestamp is within 200ms of actual time');

        // these are obvious but they help us get 100% code coverage
        // since we're letting the storage get the actual current time
        // instead of relying on _now
        t.same(storage.authors(), [keypair1.address], 'authors match');
        t.same(storage.paths(), ['/path1'], 'paths match');
        t.same(storage.documents(), [doc], 'documents match');
        t.same(storage.contents(), ['hello'], 'contents match');

        t.end();
    });

    t.test(scenario.description + ': overwrite expired ephemeral doc with another one', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1!', content: 'hello', timestamp: now, deleteAfter: now+10}), WriteResult.Accepted, 'write ephemeral doc');
        t.same(storage.authors(), [keypair1.address], "doc shows up in authors()");
        storage._now = now + 100;
        t.same(storage.authors(), [], "expired doc does not show up in authors()");
        t.same(storage.getDocument('/path1!'), undefined, "now it's expired and is not returned");

        t.end();
    });

}
