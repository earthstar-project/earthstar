import { CryptoChloride } from '../cryptoChloride';
import { CryptoNode } from '../cryptoNode';
import { encodePair } from '../cryptoUtil';
let log = console.log;

let msg = 'hello';

log('---------------------------------------------------');
log('chloride');

let keysCh = encodePair(CryptoChloride.generateKeypairBuffers());
log(keysCh);

let sigCh = CryptoChloride.sign(keysCh, msg);
log('sig:', sigCh);
log('verify good sig:', CryptoChloride.verify(keysCh.public, sigCh, msg));
log('verify bad sig:', CryptoChloride.verify(keysCh.public, sigCh, 'xxx'));
log();

log('---------------------------------------------------');
log('node');

let keysN = encodePair(CryptoNode.generateKeypairBuffers());
log(keysN);

let sigN = CryptoNode.sign(keysN, msg);
log('sig:', sigN);
log('verify good sig:', CryptoNode.verify(keysN.public, sigN, msg));
log('verify bad sig:', CryptoNode.verify(keysN.public, sigN, 'xxx'));
log();

log('---------------------------------------------------');
log('cross');

log('sign in node, verify in chloride');
let sigN2 = CryptoNode.sign(keysN, msg);
log('verify good sig:', CryptoChloride.verify(keysN.public, sigN2, msg));
log('verify bad sig:', CryptoChloride.verify(keysN.public, sigN2, 'xxx'));
log();

log('sign in chloride, verify in node');
let sigCh2 = CryptoChloride.sign(keysCh, msg);
log('verify good sig:', CryptoNode.verify(keysCh.public, sigCh2, msg));
log('verify bad sig:', CryptoNode.verify(keysCh.public, sigCh2, 'xxx'));
log();
