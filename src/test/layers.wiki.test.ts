import t = require('tap');
import {
    AuthorAddress,
    FormatName,
    IStorage,
    IValidator,
} from '../util/types';
import {
    generateAuthorKeypair
} from '../crypto/crypto';
import {
    ValidatorEs2
} from '../validator/es2';
import {
    StorageMemory
} from '../storage/memory';
import {
    WikiLayer,
    WikiPageDetail,
    WikiPageInfo,
} from '../layers/wiki';

let log = console.log;

//================================================================================
// prepare for test scenarios

let WORKSPACE = '//gardenclub.xxxxxxxxxxxxxxxxxxxx';
let FORMAT : FormatName = 'es.2';
let VALIDATORS : IValidator[] = [ValidatorEs2];

let keypair1 = generateAuthorKeypair('test');
let keypair2 = generateAuthorKeypair('twoo');
let keypair3 = generateAuthorKeypair('thre');
let author1: AuthorAddress = keypair1.address;
let author2: AuthorAddress = keypair2.address;
let author3: AuthorAddress = keypair3.address;
let now = 1500000000000000;

let makeStorage = (workspace : string) : IStorage =>
    new StorageMemory(VALIDATORS, workspace);

let sparkleEmoji = '✨';

//================================================================================

t.test('makePagePath', (t: any) => {
    t.same(WikiLayer.makePagePath('shared', 'Dogs'), '/wiki/shared/Dogs');
    t.same(WikiLayer.makePagePath('shared', 'Small Dogs'), '/wiki/shared/Small%20Dogs');
    t.same(WikiLayer.makePagePath(author1, 'Dogs'), `/wiki/~${author1}/Dogs`);
    t.same(WikiLayer.makePagePath(author1, 'Small Dogs'), `/wiki/~${author1}/Small%20Dogs`);
    t.throws(() => WikiLayer.makePagePath('xxxx', 'Dogs'), 'owner must be "shared" or an author address');
    t.throws(() => WikiLayer.makePagePath('shared', ''), 'title cannot be empty string');
    t.end();
});

t.test('parsePagePath', (t: any) => {
    t.same(WikiLayer.parsePagePath('/wiki/shared/Dogs'), {
        path: '/wiki/shared/Dogs',
        owner: 'shared',
        title: 'Dogs',
    });
    t.same(WikiLayer.parsePagePath('/wiki/shared/Small%20Dogs'), {
        path: '/wiki/shared/Small%20Dogs',
        owner: 'shared',
        title: 'Small Dogs',
    });
    t.same(WikiLayer.parsePagePath(`/wiki/~${author1}/Dogs`), {
        path: `/wiki/~${author1}/Dogs`,
        owner: author1,
        title: 'Dogs',
    });
    t.same(WikiLayer.parsePagePath(`/wiki/~${author1}/Small%20Dogs`), {
        path: `/wiki/~${author1}/Small%20Dogs`,
        owner: author1,
        title: 'Small Dogs',
    });
    t.equal(WikiLayer.parsePagePath('/wiki/shared/Dogs/foo'), null, 'too many slashes');
    t.equal(WikiLayer.parsePagePath('/wiki/shared/'), null, 'title is empty string');
    t.equal(WikiLayer.parsePagePath('/wiki/xxxx/Dogs'), null, 'invalid owner');
    t.equal(WikiLayer.parsePagePath('/wiki/Dogs'), null, 'no owner');
    t.equal(WikiLayer.parsePagePath(`/wiki/${author1}/Dogs`), null, 'no tilde');
    t.equal(WikiLayer.parsePagePath('/about/foo'), null, 'not a wiki path at all');
    t.equal(WikiLayer.parsePagePath('/wiki/shared/%2'), null, 'invalid percent-encoding');
    t.equal(WikiLayer.parsePagePath(''), null, 'empty path');
    t.end();
});

t.test('with empty storage', (t: any) => {
    let storage = makeStorage(WORKSPACE);
    let wiki = new WikiLayer(storage, keypair1);

    // read while empty
    t.same(wiki.listPageInfos(), [], 'list page info: empty');
    t.same(wiki.listPageInfos({ owner: 'shared' }), [], 'list page info owner=shared: empty');
    t.same(wiki.listPageInfos({ owner: author1 }), [], 'list page info owner=author1: empty');
    t.same(wiki.listPageInfos({ participatingAuthor: author1 }), [], 'list page info participatingAuthor=author1: empty');
    t.throws(() => wiki.listPageInfos({ owner: 'xxxx' }), 'throws with invalid owner');
    t.doesNotThrow(() => wiki.listPageInfos({ participatingAuthor: 'xxxx' }), 'does not throw with invalid participatingAuthor');

    // do some writes
    t.ok(wiki.setPageText(WikiLayer.makePagePath('shared', 'Small Dogs'), 'page text 1', now), 'write');
    t.ok(wiki.setPageText(WikiLayer.makePagePath('shared', 'Small Dogs'), 'page text 2', now + 5), 'write again');

    t.ok(wiki.setPageText(WikiLayer.makePagePath(author1, 'Dogs'), 'dogs dogs', now), 'write to owned page');

    t.notOk(wiki.setPageText(WikiLayer.makePagePath(author2, 'Dogs'), 'dogs dogs', now), 'write to page of another author should fail');

    // read them back
    t.same(wiki.getPageDetails('/wiki/shared/Small%20Dogs'), {
        path: '/wiki/shared/Small%20Dogs',
        title: 'Small Dogs',
        owner: 'shared',
        lastAuthor: author1,
        timestamp: now + 5,
        text: 'page text 2',
    }, 'getPageDetails returns second write');
    t.same(wiki.getPageDetails(`/wiki/~${author1}/Dogs`), {
        path: `/wiki/~${author1}/Dogs`,
        title: 'Dogs',
        owner: author1,
        lastAuthor: author1,
        timestamp: now,
        text: 'dogs dogs',
    }, 'getPageDetails returns owned page');

    // reads that should fail
    t.equal(wiki.getPageDetails(''), null, 'getPageDetails with bad path');
    t.equal(wiki.getPageDetails('/wiki/xxx/Dogs'), null, 'getPageDetails with bad path');
    t.equal(wiki.getPageDetails('/wiki/shared/Cats'), null, 'getPageDetails with nonexistant path');
    t.equal(wiki.getPageDetails(`/wiki/~${author2}/Dogs`), null, 'should not find a write from another author - we do not have permission to write it');

    // list pages again
    let sharedInfo : WikiPageInfo = {
        path: '/wiki/shared/Small%20Dogs',
        owner: 'shared',
        title: 'Small Dogs',
    };
    let myInfo : WikiPageInfo = {
        path: `/wiki/~${author1}/Dogs`,
        owner: author1,
        title: 'Dogs',
    }
    t.same(wiki.listPageInfos(), [sharedInfo, myInfo], 'list page info');
    t.same(wiki.listPageInfos({ owner: 'shared' }), [sharedInfo], 'list page info: shared');
    t.same(wiki.listPageInfos({ owner: author1 }), [myInfo], 'list page info: mine');

    // TODO: these need to be tested with more than one author in the db
    t.same(wiki.listPageInfos({ owner: 'shared', participatingAuthor: author1 }), [sharedInfo], 'list page info: shared (b)');
    t.same(wiki.listPageInfos({ owner: author1, participatingAuthor: author1 }), [myInfo], 'list page info: mine (b)');
    t.same(wiki.listPageInfos({ participatingAuthor: author1 }), [sharedInfo, myInfo], 'list page info: my edits');

    t.end();
});


