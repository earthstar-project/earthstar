import t = require('tap');
import {
    AuthorAddress,
    AuthorKeypair,
    IStorage,
    IValidator,
    NotFoundError,
    ValidationError,
    WriteResult,
    isErr,
} from '../util/types';
import {
    generateAuthorKeypair
} from '../crypto/crypto';
import {
    ValidatorEs4
} from '../validator/es4';
import {
    StorageMemory
} from '../storage/memory';
import {
    LayerWiki,
    WikiPageInfo,
} from '../layers/wiki';

//================================================================================
// prepare for test scenarios

let WORKSPACE = '+gardenclub.xxxxxxxxxxxxxxxxxxxx';
let VALIDATORS : IValidator[] = [ValidatorEs4];

let keypair1 = generateAuthorKeypair('test') as AuthorKeypair;
let keypair2 = generateAuthorKeypair('twoo') as AuthorKeypair;
let keypair3 = generateAuthorKeypair('thre') as AuthorKeypair;
if (isErr(keypair1)) { throw "oops"; }
if (isErr(keypair2)) { throw "oops"; }
if (isErr(keypair3)) { throw "oops"; }
let author1: AuthorAddress = keypair1.address;
let author2: AuthorAddress = keypair2.address;
let author3: AuthorAddress = keypair3.address;
let now = 1500000000000000;

let makeStorage = (workspace : string) : IStorage =>
    new StorageMemory(VALIDATORS, workspace);

let sparkleEmoji = '✨';

//================================================================================

t.test('makePagePath', (t: any) => {
    t.same(LayerWiki.makePagePath('shared', 'Dogs'), '/wiki/shared/Dogs.md');
    t.same(LayerWiki.makePagePath('shared', 'Small Dogs'), '/wiki/shared/Small%20Dogs.md');
    t.same(LayerWiki.makePagePath(author1, 'Dogs'), `/wiki/~${author1}/Dogs.md`);
    t.same(LayerWiki.makePagePath(author1, 'Small Dogs'), `/wiki/~${author1}/Small%20Dogs.md`);
    t.ok(isErr(LayerWiki.makePagePath('xxxx', 'Dogs')), 'owner must be "shared" or an author address');
    t.ok(isErr(LayerWiki.makePagePath('shared', '')), 'title cannot be empty string');
    t.end();
});

t.test('parsePagePath', (t: any) => {
    t.same(LayerWiki.parsePagePath('/wiki/shared/Dogs.md'), {
        path: '/wiki/shared/Dogs.md',
        owner: 'shared',
        title: 'Dogs',
    }, 'shared path');
    t.same(LayerWiki.parsePagePath('/wiki/shared/Small%20Dogs.md'), {
        path: '/wiki/shared/Small%20Dogs.md',
        owner: 'shared',
        title: 'Small Dogs',
    }, 'shared path with percent');
    t.same(LayerWiki.parsePagePath(`/wiki/~${author1}/Dogs.md`), {
        path: `/wiki/~${author1}/Dogs.md`,
        owner: author1,
        title: 'Dogs',
    }, 'owned path');
    t.same(LayerWiki.parsePagePath(`/wiki/~${author1}/Small%20Dogs.md`), {
        path: `/wiki/~${author1}/Small%20Dogs.md`,
        owner: author1,
        title: 'Small Dogs',
    }, 'owned path with percent');
    t.ok(isErr(LayerWiki.parsePagePath('/wiki/shared/Dogs')), 'no trailing .md');
    t.ok(isErr(LayerWiki.parsePagePath('/wiki/shared/Dogs/foo.md')), 'too many slashes');
    t.ok(isErr(LayerWiki.parsePagePath('/wiki/shared/Dogs.md/foo')), 'too many slashes');
    t.ok(isErr(LayerWiki.parsePagePath('/wiki/shared/')), 'title is empty string');
    t.ok(isErr(LayerWiki.parsePagePath('/wiki/shared/.md')), 'title is empty string with .md');
    t.ok(isErr(LayerWiki.parsePagePath('/wiki/xxxx/Dogs.md')), 'invalid owner');
    t.ok(isErr(LayerWiki.parsePagePath('/wiki/Dogs.md')), 'no owner');
    t.ok(isErr(LayerWiki.parsePagePath(`/wiki/${author1}/Dogs.md`)), 'owner with no tilde');
    t.ok(isErr(LayerWiki.parsePagePath('/about/foo')), 'not a wiki path at all');
    t.ok(isErr(LayerWiki.parsePagePath('/wiki/shared/%2.md')), 'invalid percent-encoding');
    t.ok(isErr(LayerWiki.parsePagePath('')), 'empty path');
    t.end();
});

t.test('with empty storage', (t: any) => {
    let storage = makeStorage(WORKSPACE);
    let wiki = new LayerWiki(storage);

    // read while empty
    t.same(wiki.listPageInfos(), [], 'list page info: empty');
    t.same(wiki.listPageInfos({ owner: 'shared' }), [], 'list page info owner=shared: empty');
    t.same(wiki.listPageInfos({ owner: author1 }), [], 'list page info owner=author1: empty');
    t.same(wiki.listPageInfos({ participatingAuthor: author1 }), [], 'list page info participatingAuthor=author1: empty');
    t.throws(() => wiki.listPageInfos({ owner: 'xxxx' }), 'throws with invalid owner');
    t.doesNotThrow(() => wiki.listPageInfos({ participatingAuthor: 'xxxx' }), 'does not throw with invalid participatingAuthor');

    // do some writes
    let smallDogsPath = LayerWiki.makePagePath('shared', 'Small Dogs');
    t.same(wiki.setPageText(keypair1, smallDogsPath, 'page text 1', now), WriteResult.Accepted, 'write');
    t.same(wiki.setPageText(keypair1, smallDogsPath, 'page text 2', now + 5), WriteResult.Accepted, 'write again');

    t.same(wiki.setPageText(keypair1, LayerWiki.makePagePath(author1, 'Dogs'), 'dogs dogs', now), WriteResult.Accepted, 'write to owned page');

    t.ok(isErr(wiki.setPageText(keypair1, LayerWiki.makePagePath(author2, 'Dogs'), 'dogs dogs', now)), 'write to page of another author should fail');

    // read them back
    t.same(wiki.getPageDetails('/wiki/shared/Small%20Dogs.md'), {
        path: '/wiki/shared/Small%20Dogs.md',
        title: 'Small Dogs',
        owner: 'shared',
        lastAuthor: author1,
        timestamp: now + 5,
        text: 'page text 2',
    }, 'getPageDetails returns second write');
    t.same(wiki.getPageDetails(`/wiki/~${author1}/Dogs.md`), {
        path: `/wiki/~${author1}/Dogs.md`,
        title: 'Dogs',
        owner: author1,
        lastAuthor: author1,
        timestamp: now,
        text: 'dogs dogs',
    }, 'getPageDetails returns owned page');

    // reads that should fail
    t.ok(wiki.getPageDetails('') instanceof ValidationError, null, 'getPageDetails with bad path');
    t.ok(wiki.getPageDetails('/wiki/xxx/Dogs.md') instanceof ValidationError, null, 'getPageDetails with bad path');
    t.ok(wiki.getPageDetails('/wiki/shared/Cats.md') instanceof NotFoundError, null, 'getPageDetails with nonexistant path');
    t.ok(wiki.getPageDetails(`/wiki/~${author2}/Dogs.md`) instanceof NotFoundError, null, 'should not find a write from another author - we do not have permission to write it');

    // list pages again
    let sharedInfo : WikiPageInfo = {
        path: '/wiki/shared/Small%20Dogs.md',
        owner: 'shared',
        title: 'Small Dogs',
    };
    let myInfo : WikiPageInfo = {
        path: `/wiki/~${author1}/Dogs.md`,
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
