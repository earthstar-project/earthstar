import { LowLevelCrypto } from '../crypto/crypto';

// A set of functions for deterministally choosing random-like values
// that are based on the hash of a string.
//
// These return the same results every time (for the same input string).
//
// These are useful for randomly displaying authors with different colors,
// etc, based on their author address.  If doing that, it's best to also
// include the logged-in user's secret so that each user sees different
// random colors.  Otherwise an impersonator could easily make a
// identity that happened to match the color of their target, by brute
// force search.
// E.g.
//    let colorList = ['#f90', '#aaa', ... etc ];
//    let author_color = detChoice(author.address + logged_in_author.secret, colorList);
//
// Or generate your own CSS color strings for more variety, based on detRandom.
//
// TODO: benchmark -- is sha256 too slow?
// Consider using md5 instead since this is not security-critical.
// Consider memoizing these functions for speed.

export let detRandom = (s: string | Buffer): number => {
    // return a random-ish float between 0 and 1, deterministically derived from a hash of the string

    let hashBuffer = LowLevelCrypto.sha256(s);
    // take first 4 bytes of hash and convert to unsigned 32 bit integer (big-endian)
    // https://github.com/nodejs/node/blob/44161274821a2e81e7a5706c06cf8aa8bd2aa972/lib/internal/buffer.js#L291-L302
    let randInt = hashBuffer.slice(4).readUInt32BE();
    // divide by max possible value
    return randInt / 2 ** 32;
};

export let detRange = (s: string | Buffer, lo: number, hi: number): number =>
    // a float in the range [lo, hi]
    detRandom(s) * (hi - lo) + lo;

export let detInt = (s: string | Buffer, lo: number, hi: number): number =>
    // an integer in the range [lo, hi] -- inclusive of the endpoint
    Math.floor(detRandom(s) * ((hi + 1) - lo) + lo);

export let detChoice = <T>(s: string | Buffer, array: T[]): T =>
    // deterministically choose a random-ish item from the array
    array[Math.floor(detRandom(s) * array.length)];
