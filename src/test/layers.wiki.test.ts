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
    t.same(WikiLayer.makePagePath('Dogs', 'shared'), '/wiki/shared/Dogs');
    t.same(WikiLayer.makePagePath('Small Dogs', 'shared'), '/wiki/shared/Small%20Dogs');
    t.same(WikiLayer.makePagePath('Dogs', author1), `/wiki/~${author1}/Dogs`);
    t.same(WikiLayer.makePagePath('Small Dogs', author1), `/wiki/~${author1}/Small%20Dogs`);
    t.throws(() => WikiLayer.makePagePath('Dogs', 'xxxx'), 'owner must be "shared" or an author address');
    t.throws(() => WikiLayer.makePagePath('', 'shared'), 'title cannot be empty string');
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
    t.end();
});

/*
t.test('with empty storage', (t: any) => {
    let storage = makeStorage(WORKSPACE);
    let wiki = new WikiLayer(storage, keypair1);

    t.same(wiki.listPageInfos(), [], 'list page info: empty');
    t.same(wiki.listPageInfos('shared'), [], 'list page info shared: empty');
    t.same(wiki.listPageInfos(author1), [], 'list page info author1: empty');

    t.end();
});
*/


