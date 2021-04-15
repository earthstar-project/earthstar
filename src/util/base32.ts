import multibase = require('multibase');
import { base32, codec } from "rfc4648";

import { Base32String } from '../types/docTypes';
import { ValidationError} from './errors';

/**
 * For base32 encoding we use rfc4648, no padding, lowercase, prefixed with "b".
 * 
 * Base32 character set: `abcdefghijklmnopqrstuvwxyz234567`
 * 
 * The Multibase format adds a "b" prefix to specify this particular encoding.
 * We leave the "b" prefix there because we don't want the encoded string
 * to start with a number (so we can use it as a URL location).
 * 
 * When decoding, we require it to start with a "b" --
 * no other multibase formats are allowed.
 * 
 * The decoding must be strict (it doesn't allow a 1 in place of an i, etc).
 */
export let bufferToBase32StringMultibase = (buf: Buffer): Base32String =>
    multibase.encode('base32', buf).toString();

/**
* Decode base32 data to a Buffer.  Throw a ValidationError if the string is bad.
*/
export let base32StringToBufferMultibase = (str: Base32String): Buffer => {
    if (!str.startsWith('b')) { throw new ValidationError("can't decode base32 string - it should start with a 'b'. " + str); }
    // enforce only lower case characters
    if (str !== str.toLowerCase()) {
        throw new ValidationError("can't decode base32 string - it contains uppercase characters");
    }
    // this can also throw an Error('invalid base32 character')
    return multibase.decode(str);
};


//================================================================================

const myEncoding = {
    chars: "abcdefghijklmnopqrstuvwxyz234567",
    bits: 5,
};

export let bufferToBase32StringRfc = (buf: Buffer): Base32String =>
    'b' + codec.stringify(buf, myEncoding, { pad: false });

export let base32StringToBufferRfc = (str: Base32String): Buffer => {
    if (!str.startsWith('b')) { throw new ValidationError("can't decode base32 string - it should start with a 'b'. " + str); }
    // this library combines padding and looseness settings into a single "loose" option, so
    // we have to set "loose: true" in order to handle unpadded inputs.
    // with a custom codec, loose mode:
    // -- allows padding or no padding
    // -- does not allow uppercase
    // -- does not allow 1/i substitution

    // make sure no padding characters are on the end
    if (str[str.length-1] === '=') {
        throw new ValidationError("can't decode base32 string - it contains padding characters ('=')");
    }
    return codec.parse(str.slice(1), myEncoding, { loose: true, out: Buffer.alloc as any }) as any as Buffer;
};
