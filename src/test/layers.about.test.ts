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
    ValidatorEs3
} from '../validator/es3';
import {
    StorageMemory
} from '../storage/memory';
import {
    LayerAbout,
    AuthorProfile,
} from '../layers/about';

//================================================================================
// prepare for test scenarios

let WORKSPACE = '+gardenclub.xxxxxxxxxxxxxxxxxxxx';
let FORMAT : FormatName = 'es.3';
let VALIDATORS : IValidator[] = [ValidatorEs3];

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

t.test('with empty storage', (t: any) => {
    let storage = makeStorage(WORKSPACE);
    let about = new LayerAbout(storage);

    // add a dummy document.
    // this author should not be picked up by the about layer (TODO: is this a good decision?)
    storage.set(keypair2, {
        format: FORMAT,
        path: '/extra',
        value: 'whatever',
    });

    t.same(about.listAuthorProfiles(), [], 'listAuthors empty');
    t.equal(about.getAuthorProfile('x'), null, 'bad author address => null info');
    t.same(about.getAuthorProfile(author1), {
        address: author1,
        shortname: 'test',
        longname: null,
    }, 'missing author /about => some info but longname is null');

    t.true(about.setMyAuthorLongname(keypair1, 'Long Name 1'), 'set author longname');
    t.true(about.setMyAuthorLongname(keypair1, 'Long Name 2 ' + sparkleEmoji), 'set author longname again');

    let expectedProfile : AuthorProfile = {
        address: author1,
        shortname: 'test',
        longname: 'Long Name 2 ' + sparkleEmoji,
    };

    t.same(about.listAuthorProfiles(), [expectedProfile], 'listAuthors shows second longname');
    t.same(about.getAuthorProfile(author1), expectedProfile, 'get info returns second longname');

    t.end();
});
