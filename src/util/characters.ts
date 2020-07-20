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

export const alphaLower = 'abcdefghijklmnopqrstuvwxyz';
export const alphaUpper = alphaLower.toUpperCase();
export const digits = '0123456789';
export const authorShortnameChars = alphaLower + digits;
export const workspaceNameChars = alphaLower + digits;
export const b32chars = alphaLower + digits;  // approximately speaking
export const b58chars = alphaLower + alphaUpper + digits;  // approximately speaking
export const pathPunctuation = "/'()-._~!*$&+,:=?@%";  // no spaces or double quotes because they're not allowed in URLs
export const pathChars = alphaLower + alphaUpper + digits + pathPunctuation;
