import { codec } from "rfc4648";

import { Base32String } from '../util/doc-types';
import { ValidationError} from '../util/errors';

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

const myEncoding = {
    // this should match b32chars from characters.ts
    chars: "abcdefghijklmnopqrstuvwxyz234567",
    bits: 5,
};

/**
 * Encode uint8array bytes to base32 string
 */
export let base32BytesToString = (bytes: Uint8Array): Base32String =>
    'b' + codec.stringify(bytes, myEncoding, { pad: false });

/**
* Decode base32 string to a uint8array of bytes.  Throw a ValidationError if the string is bad.
*/
export let base32StringToBytes = (str: Base32String): Uint8Array => {
    if (!str.startsWith('b')) { throw new ValidationError("can't decode base32 string - it should start with a 'b'. " + str); }

    // this library combines padding and looseness settings into a single "loose" option, so
    // we have to set "loose: true" in order to handle unpadded inputs.
    // with a custom codec, loose mode:
    // -- allows padding or no padding -- we have to check for this
    // -- does not allow uppercase -- good
    // -- does not allow 1/i substitution -- good

    // make sure no padding characters are on the end
    if (str[str.length-1] === '=') {
        throw new ValidationError("can't decode base32 string - it contains padding characters ('=')");
    }
    return codec.parse(str.slice(1), myEncoding, { loose: true });
};
