export let onlyHasChars = (str : string, allowedChars : string) : boolean => {
    for (let s of str) {
        if (allowedChars.indexOf(s) === -1) { return false; }
    }
    return true;
}
export let isOnlyPrintableAscii = (s : string) : boolean => {
    let buf = Buffer.from(s, 'utf8');
    for (let char of buf) {
        // char must be between ' ' (space) and '~' inclusive
        if (char < 32 || char > 126) { return false; }
    }
    return true;
}

let makePrintableAscii = () : string => {
    let chars : string[] = [];
    for (let ii = 32; ii <= 126; ii++) {
        chars.push(String.fromCharCode(ii));
    }
    return chars.join('');
}
export let printableAscii = makePrintableAscii();

export const alphaLower = 'abcdefghijklmnopqrstuvwxyz';
export const alphaUpper = alphaLower.toUpperCase();
export const digits = '0123456789';
export const b32chars = alphaLower + '234567';
export const hexLower = digits + 'abcdef';

export const authorShortnameChars = alphaLower + digits;
export const authorAddressChars = authorShortnameChars + b32chars + '@.';

export const workspaceNameChars = alphaLower + digits;
export const workspaceAddressChars = workspaceNameChars + b32chars + '+.';

// Path special characters should be usable in regular web URLs without percent-encoding.
// Notably not allowed:
//    space  not allowed in URLs
//    "      not allowed in URLs
//    ?      to avoid confusion with URL query parameters
export const pathPunctuation = "/'()-._~!*$&+,:=@%";
export const pathChars = alphaLower + alphaUpper + digits + pathPunctuation;


