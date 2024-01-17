/** Check that a string only contains character from a string of allowed characters. */
export function onlyHasChars(str: string, allowedChars: string): boolean {
  for (const s of str) {
    if (allowedChars.indexOf(s) === -1) return false;
  }
  return true;
}

/** Check that a string contains only printable ASCII */
export function isOnlyPrintableAscii(s: string): boolean {
  const bytes = new TextEncoder().encode(s);
  for (const byte of bytes) {
    // char must be between ' ' (space) and '~' inclusive
    if (byte < 32 || byte > 126) return false;
  }
  return true;
}

/* Check that a string is exactly one digit. */
export function isDigit(ch: string): boolean {
  if (ch === "") return false;
  return digits.indexOf(ch) !== -1;
}

/** Lowercase alphabetical characters. */
export const alphaLower = "abcdefghijklmnopqrstuvwxyz";
/** Uppercase alphabetical characters. */
export const alphaUpper = alphaLower.toUpperCase();
/** All digits. */
export const digits = "0123456789";
/** All characters allowed in base32. */
export const b32chars = alphaLower + "234567";

/** All characters allowed in an identity's short name. */
export const authorNameChars = alphaLower + digits;
/** All characters allowed in an identity's pub key. */
export const authorKeyChars = b32chars;
/** All characters allowed in an identity's public address. */
export const authorAddressChars = authorNameChars + b32chars + "@.";

/** All characters allowed in a share's name. */
export const workspaceNameChars = alphaLower + digits;
/** All characters allowed in a share's key. */
export const workspaceKeyChars = b32chars;
/** All characters allowed in a share's address. */
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

/** All special characters permitted in a document's path. */
export const pathPunctuation = "/'()-._~!$&+,:=@%"; // note double quotes are not included
/** All characters permitted in a document's path. */
export const pathChars = alphaLower + alphaUpper + digits + pathPunctuation;
