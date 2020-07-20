import * as mb from 'multibase';
import crypto = require('crypto');
//import base32 = require('base32.js');
import { digits } from '../util/characters';

let log = console.log;

let buf = crypto.randomBytes(32);
//let b64pad = 'Mzsetcc1/UyinnBQSU0+YisT03WXI/3wLslmMbOFW9mY=';
//let buf = Buffer.from(b64pad.slice(1), 'base64');
//let buf2 = mb.decode(b64pad);
//log('encoding:', mb.isEncoded(b64pad));
log(buf);
//log(buf2);
//log();

let bases = [
    'base16',
    'base32',
    'base32hex',
    //'base32hexpad',
    //'base32pad',
    'base32z',
    // // // 'base32crockford',  // from base32.js
    'base58btc',
    //'base58flickr',
    //'base64',
    //'base64pad',
    //'base64url',
    //'base64urlpad',
];

let myEncode = (base : string, buf : Buffer) : string => {
    //if (base === 'base32crockford') {
    //    let encoder = new base32.Encoder({ type: "crockford", lc: true });  // lc = lower-case
    //    return encoder.write(buf).finalize();
    //} else {
        return mb.encode(base as any, buf).toString().slice(1);
    //}
}


let results : any[] = [];

for (let base of bases) {
    let encoded = myEncode(base, buf);
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
    log(format.padEnd(16, ' '), ('' + len).padStart(3, ' '), ' ' + encoded);
}

//================================================================================

let digitStartCountByBase : {[key:string] : number} = {}
let count = 10000;
for (let base of bases) {
    for (let ii = 0; ii < count; ii++) {
        let buf = crypto.randomBytes(32);
        let enc = myEncode(base, buf);
        if (enc[0] >= '0' && enc[0] <= '9') {
            digitStartCountByBase[base] = (digitStartCountByBase[base] || 0) + 1
        }
    }
}
for (let base of bases) {
    digitStartCountByBase[base] = Math.round((digitStartCountByBase[base] || 0) / count * 100 * 100)/100;
}
log()
log('percent of encoded strings that start with a digit:')
log(JSON.stringify(digitStartCountByBase, null, 4))

//let enc = 'biiiiiii';
//console.log(mb.decode(enc));
