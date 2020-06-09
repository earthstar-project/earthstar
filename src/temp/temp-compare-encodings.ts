import * as mb from 'multibase';
import * as crypto from '../crypto';

let log = console.log;

//let buf = crypto.randomBytes(32);
let b64pad = 'Mzsetcc1/UyinnBQSU0+YisT03WXI/3wLslmMbOFW9mY=';
let buf = Buffer.from(b64pad.slice(1), 'base64');
let buf2 = mb.decode(b64pad);
log('encoding:', mb.isEncoded(b64pad));
log(buf);
log(buf2);
log();

let bases = [
    'base16',
    'base32',
    'base32hex',
    'base32hexpad',
    'base32pad',
    'base32z',
    'base58btc',
    'base58flickr',
    'base64',
    'base64pad',
    'base64url',
    'base64urlpad',
];


let results : any[] = [];

for (let base of bases) {
    let encoded = mb.encode(base as any, buf).toString();
    results.push({
        format: base,
        len: encoded.length,
        encoded: encoded,
    });
}
results.push({
    format: 'raw bytes',
    len: 32,
    encoded: '................................',
})

for (let {format, len, encoded} of results) {
    log(format.padEnd(14, ' '), ('' + len).padStart(3, ' '), encoded);
}
