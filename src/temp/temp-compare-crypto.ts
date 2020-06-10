import { CryptoChloride } from '../crypto/cryptoChloride';
import { CryptoNode } from '../crypto/cryptoNode';
import {
    encodePubkey,
    encodeSecret,
} from '../crypto/encoding';
let log = console.log;

let msg = 'hello';

log('---------------------------------------------------');
log('chloride');

let keysCh = CryptoChloride.generateKeypairBuffers();
log(keysCh);
log({
    pubkey: encodePubkey(keysCh.pubkey),
    secret: encodeSecret(keysCh.secret),
});

let sigCh = CryptoChloride.sign(keysCh, msg);
log('sig:', sigCh);
log('verify good sig:', CryptoChloride.verify(keysCh.pubkey, sigCh, msg));
log('verify bad sig:', CryptoChloride.verify(keysCh.pubkey, sigCh, 'xxx'));
log();

log('---------------------------------------------------');
log('node');

let keysN = CryptoNode.generateKeypairBuffers();
log(keysN);
log({
    pubkey: encodePubkey(keysN.pubkey),
    secret: encodeSecret(keysN.secret),
});

let sigN = CryptoNode.sign(keysN, msg);
log('sig:', sigN);
log('verify good sig:', CryptoNode.verify(keysN.pubkey, sigN, msg));
log('verify bad sig:', CryptoNode.verify(keysN.pubkey, sigN, 'xxx'));
log();

log('---------------------------------------------------');
log('cross');

log('sign in node, verify in chloride');
let sigN2 = CryptoNode.sign(keysN, msg);
log('verify good sig:', CryptoChloride.verify(keysN.pubkey, sigN2, msg));
log('verify bad sig:', CryptoChloride.verify(keysN.pubkey, sigN2, 'xxx'));
log();

log('sign in chloride, verify in node');
let sigCh2 = CryptoChloride.sign(keysCh, msg);
log('verify good sig:', CryptoNode.verify(keysCh.pubkey, sigCh2, msg));
log('verify bad sig:', CryptoNode.verify(keysCh.pubkey, sigCh2, 'xxx'));
log();
