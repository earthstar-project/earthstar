import { stringToBytes } from "../util/bytes.ts";

export let onlyHasChars = (str: string, allowedChars: string): boolean => {
  for (let s of str) {
    if (allowedChars.indexOf(s) === -1) return false;
  }
  return true;
};

export let isOnlyPrintableAscii = (s: string): boolean => {
  let bytes = stringToBytes(s);
  for (let byte of bytes) {
    // char must be between ' ' (space) and '~' inclusive
    if (byte < 32 || byte > 126) return false;
  }
  return true;
};

// is ch exactly one digit?
export let isDigit = (ch: string): boolean => {
  if (ch === "") return false;
  return digits.indexOf(ch) !== -1;
};

export const alphaLower = "abcdefghijklmnopqrstuvwxyz";
export const alphaUpper = alphaLower.toUpperCase();
export const digits = "0123456789";
export const b32chars = alphaLower + "234567";

export const authorNameChars = alphaLower + digits;
export const authorKeyChars = b32chars;
export const authorAddressChars = authorNameChars + b32chars + "@.";

export const workspaceNameChars = alphaLower + digits;
export const workspaceKeyChars = alphaLower + digits;
export const workspaceAddressChars = workspaceNameChars + b32chars + "+.";

// Characters allowed in Earthstar paths
//---------------------------------------------
// These allowed path characters should be usable in regular web URLs
// without percent-encoding them or interfering with the rest of the URL.
//
// Allowed      Earthstar Meaning
//    a-zA-Z0-9    no meaning
//    '()-_$&,:=   no meaning
//    /            starts paths; path segment separator
//    !            ephemeral docs must contain at least one '!'
//    ~            denotes path ownership (write permissions)
//    +@.          used by workspace and author names but allowed elsewhere too
//    %            used for percent-encoding
//
// Disallowed       Reason
//    space            not allowed in URLs
//    <>"[\]^`{|}      not allowed in URLs (though some browsers allow some of them)
//    ?                to avoid confusion with URL query parameters
//    #                to avoid confusion with URL anchors
//    ;                no reason
//    *                no reason; maybe useful for querying in the future
//    non-ASCII chars  to avoid trouble with Unicode normalization
//    ASCII whitespace
//    ASCII control characters
//
// (Regular URL character rules are in RFC3986, RFC1738, and https://url.spec.whatwg.org/#url-code-points )
//
// To use other characters in a path, percent-encode them using encodeURI.
// For example
//      desiredPath = '/food/🍆/nutrition'
//      earthstarPath = encodeURI(desiredPath);  // --> '/food/%F0%9F%8D%86/nutrition'
//      store it as earthstarPath
//      for display to users again, run decodeURI(earthstarPath)
//

export const pathPunctuation = "/'()-._~!$&+,:=@%"; // note double quotes are not included
export const pathChars = alphaLower + alphaUpper + digits + pathPunctuation;
