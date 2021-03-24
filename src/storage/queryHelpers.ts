import {
    Document, ValidationError,
} from '../util/types';
import {
    IStorage,
    IStorageAsync
} from './storageTypes';
import {
    Query
} from './query';

//================================================================================
// HELPERS

/*
 * Escape a string so it's safe to use in a regular expression.
 * (Put a backslash in front of each special regex character
 *  so the string won't trigger any regex behavior).
 */
export let escapeStringForRegex = (s: string): string => {
    // Javascript regex syntax characters:
    // https://tc39.es/ecma262/#prod-SyntaxCharacter
    //    ^ $ \ . * + ? ( ) [ ] { } |

    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
};

let replaceAll = (str: string, from: string, to: string): string => {
    return str.split(from).join(to);
};

// how many times does the character occur in the string?
let countChars = (str: string, char: string) => {
    return str.split(char).length - 1;
};

// same as string.matchAll(regex) which is only supported in node 12+
// returns [
//    0: full match,
//    1: group part of the match,
//    index: number,
//    input: string,
//    groups: undefined
// ]
// TODO: bug: this loops forever when the regex does not have the 'g' flag
// because it keeps returning the first match.
let matchAll = (re: RegExp, str: string): RegExpExecArray[] => {
    if (re.flags.indexOf('g') === -1) {
        throw new Error('this matchAll function only works on global regexes (with "g")');
    }
    let matches: RegExpExecArray[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(str)) !== null) {
        matches.push(m)
    }
    return matches;
}

//================================================================================
// GLOBS

/*
 * Helper for querying Earthstar docs using a glob-style query string.
 *
 * Given a glob string, return:
 *    - an earthstar Query
 *    - and a regular expression (as a plain string, not a RegExp instance).
 *
 * Glob strings support '*' and '**' as wildcards.
 * '**' matches any sequence of characters at all.
 * '*' matches any sequence of characters except a forward slash --
 *  it does not span directories in the path.
 * You glob string may have multiple asterisks in various positions,
 * except they cannot be directly adjecent to each other (no '***' should
 * ever occur -- this will cause a ValidationError to be thrown).
 * 
 * To use this function, run the query yourself and apply the regex
 * as a filter to the paths of the resulting documents,
 * to get only the documents whose paths match the glob.
 * The regex will be null if it's not needed.
 * 
 * The returned query will use some subset of
 * the `path`, `pathStartsWith`, and `pathEndswith` properties,
 * and no other properties.
 */

// Example glob strings:
//
//     "/posts/*/*.json"    matches "/posts/sailing/12345.json"
//
//     "/posts/**.json"     matches "/posts/sailing/12345.json"
//                              and "/posts/a/b/c/d/e/f/g/12345.json"
//                              and "/posts/.json"
//
// To use it:
// 
//    let queryByGlob = (storage: IStorage, glob: string): Document[] => {
//       let { query, pathRegex } = globToEarthstarQueryAndPathRegex(glob);
//  
//       let docs = storage.documents(query);
//       if (pathRegex != null) {
//           let re = new RegExp(pathRegex);
//           docs = docs.filter(doc => re.test(doc.path));
//       }
//       return docs;
//    }
//  
//    let posts = queryByGlob(myStorage, '/posts/*.txt');

export let globToEarthstarQueryAndPathRegex = (glob: string): { query: Query, pathRegex: string | null } => {
    // Three stars in a row are not allowed - throw
    if (glob.indexOf('***') !== -1) {
        throw new ValidationError('invalid glob query has three stars in a row: ' + glob);
    }

    // If no stars at all, this is just a direct path query.  Easy.
    if (glob.indexOf('*') === -1)  {
        return { query: { path: glob }, pathRegex: null }
    }

    // Get the parts of the glob before the first star and after the last star.
    // These will become our pathStartWith and pathEndsWith query paramters.
    let globParts = glob.split('*');
    let firstPart = globParts[0];
    let lastPart = globParts[globParts.length - 1];

    // Convert the glob into a regex.
    // First replace * and ** with characters that are not allowed in earthstar strings,
    // and are also not regex control characters...
    let regex = replaceAll(glob, '**', ';');
    regex = replaceAll(regex, '*', '#');
    // Then escape the string for regex safety...
    regex = escapeStringForRegex(regex);
    // Then finally replace the standin characters with active regex pieces.
    regex = replaceAll(regex, ';', '.*');  // any characters
    regex = replaceAll(regex, '#', '[^/]*');  // anything but slashes
    // Force the regex to match all way from beginning to end of string
    regex = '^' + regex + '$';

    // Put startsWith and endsWith into the query if needed
    let query: Query = {};
    if (firstPart) { query.pathStartsWith = firstPart; }
    if (lastPart) { query.pathEndsWith = lastPart; }

    // Special case for "**foo" or "foo**" -- no regex is needed for these,
    // we can rely completely on pathStartsWith or pathEndsWith
    let pathRegex: string | null = regex;
    if (globParts.length === 3) {
        let [a, b, c] = globParts;
        if (a === '' && b === '') { pathRegex = null }
        if (b === '' && c === '') { pathRegex = null }
    }

    return { query, pathRegex };
}

/*
 * Find documents whose path matches the glob string.
 * See documentation for globToEarthstarQueryAndPathRegex for details on
 * glob strings.
 *
 * This is a synchronous function and `storage` must be synchronous (an `IStorage`).
 * 
 * You can specify additional query options by providing a `moreQueryOptions` object.
 * For example, you might want to set { contentLengthGt: 0 } to skip documents
 * with empty content (e.g. "deleted" documents).
 * 
 * `moreQueryOptions` will override the glob's query, so it's best to avoid setting
 * `path`, `pathStartsWith` or `pathEndsWith` in your moreQueryOptions unless you
 * intend to override the glob's query.
 */
export let queryByGlobSync = (storage: IStorage, glob: string, moreQueryOptions: Query = {}): Document[] => {
    let { query, pathRegex } = globToEarthstarQueryAndPathRegex(glob);
    query = { ...query, ...moreQueryOptions };
 
    let docs = storage.documents(query);
    if (pathRegex != null) {
        let re = new RegExp(pathRegex);
        docs = docs.filter(doc => re.test(doc.path));
    }
    return docs;
}

/*
 * Find documents whose path matches the glob string.
 * See documentation for globToEarthstarQueryAndPathRegex for details on
 * glob strings.
 * 
 * This is an async function and `storage` can be either an async or sync storage
 * (`IStorage` or `IStorageAsync`).
 *
 * You can specify additional query options by providing a `moreQueryOptions` object.
 * For example, you might want to set { contentLengthGt: 0 } to skip documents
 * with empty content (e.g. "deleted" documents).
 * 
 * `moreQueryOptions` will override the glob's query, so it's best to avoid setting
 * `path`, `pathStartsWith` or `pathEndsWith` in your moreQueryOptions unless you
 * intend to override the glob's query.
 */
export let queryByGlobAsync = async (storage: IStorage | IStorageAsync, glob: string, moreQueryOptions: Query = {}): Promise<Document[]> => {
    let { query, pathRegex } = globToEarthstarQueryAndPathRegex(glob);
    query = { ...query, ...moreQueryOptions };
 
    let docs = await storage.documents(query);
    if (pathRegex != null) {
        let re = new RegExp(pathRegex);
        docs = docs.filter(doc => re.test(doc.path));
    }
    return docs;
}

//==========================================================================================
// TEMPLATES

/*
// HOW TO USE REGEXES

console.log('-------------- matchAll homebrew');
let varMatches = matchAll(variableRe, template);
console.log(varMatches.map(match => match[1]));

console.log('-------------- match');
let matches = template.match(variableRe);
console.log(matches);

console.log('-------------- exec');
let m;
while ((m = variableRe.exec(template)) !== null) {
    console.log(m);
}
*/

interface TemplateToPathMatcherReturn {
    varNames: string[],
    pathMatcherRe: string,
}
export let _templateToPathMatcherRegex = (template: string): TemplateToPathMatcherReturn => {
    // This is a low-level helper for the template matching code; don't use it directly.
    //
    // Given a template, parse it and return
    // - a list of variable names
    // - a regular expression that can be used to match against a path, with named capture groups
    //    that are named the same as the variables, to extract the variables from the path
    //
    // A variable in the template is any alphanumeric chars or underscores, in curly braces
    // like {example} or {__EXAMPLE__} or {example_1}
    //
    // Rules for templates
    //   Variable names must only contain upper and lower letters, numbers, and underscore.
    //   They cannot start with a number.
    //   They cannot be empty {}.
    //   Two variables cannot be consecutive and touching {like}{this}.
    // If variable names don't match these rules, a ValidationError will be thrown.

    //--------------------------------------------------------------------------------
    // VALIDATE TEMPLATE and extract variable names

    if (template.indexOf('}{') !== -1) { 
        throw new ValidationError('template is not allowed to have to adjacent variables {like}{this}');
    }

    let numLBrackets = countChars(template, '{');
    let numRBrackets = countChars(template, '}');
    if (numLBrackets !== numRBrackets) {
        throw new ValidationError('unbalanced curly braces');
    }

    let bracketVarRe = /\{(.*?)\}/g  // match and capture anything in curly braces, lazily, to get smallest matches
    let validVarName = /^[a-zA-Z_][a-zA-Z0-9_]*$/  // requirement for variable names: (alpha alphanum*)

    let varMatches = matchAll(bracketVarRe, template);
    // capture anything in braces...
    let varNames = varMatches.map(match => match[1]);
    // ...then check if it's a valid variable name, and throw errors if it's not
    for (let varName of varNames) {
        if (!validVarName.test(varName)) {
            throw new ValidationError('variable name in template is not valid.  can only contain alphanumeric and underscore, and not start with number');
        }
    }
    if (numLBrackets !== varNames.length || numRBrackets !== varNames.length) {
        throw new ValidationError('weird curly brace mismatch, maybe }backwards{');
    }

    //--------------------------------------------------------------------------------
    // MAKE PATH REGEX

    let parts: string[] = [];
    if (varMatches.length === 0) {
        parts.push(escapeStringForRegex(template));
    }
    for (let ii = 0; ii < varMatches.length; ii++) {
        let bracketMatch = varMatches[ii];
        let varName = bracketMatch[1];
        let matchStart = bracketMatch.index;
        let matchEnd = bracketMatch.index + bracketMatch[0].length;

        if (ii === 0) {
            let begin = template.slice(0, matchStart);
            parts.push(escapeStringForRegex(begin));
        }

        // make a regex to capture the actual value of this variable in a path
        let reForThisVariable = '(?<' + varName + '>[^/]+)';
        parts.push(reForThisVariable);
        
        if (ii <= varMatches.length - 2) {
            let nextMatch = varMatches[ii+1];
            let between = template.slice(matchEnd, nextMatch.index);
            parts.push(escapeStringForRegex(between));
        } else {
            let end = template.slice(matchEnd);
            parts.push(escapeStringForRegex(end));
        }
    }
    let pathMatcherRe = '^' + parts.join('') + '$';

    return {
        varNames: varNames,
        pathMatcherRe: pathMatcherRe,
    };
}

// This is a low-level helper for the template matching code; don't use it directly.
//
// Given a pathMatcherRe (made from a template using templateToMathMatcherRegex),
// check if a given Earthstar patch matches it.
// If it does not match, return null.
// If it does match, return an object with the variables from the template.
// A template can have zero variables; in this case we return {} on match and null on no match.
export let _matchRegexAndPath = (pathMatcherRe: string, path: string): Record<string, string> | null => {
    const matches2 = path.match(new RegExp(pathMatcherRe));
    if (matches2 === null) { return null; }
    return { ...matches2.groups };
}

/*
 * Compare template strings to actual paths and extract the variables from the paths.
 * 
 * Given a template like '/posts/{postId}.json', check if a given Earthstar patch matches it.
 * If it DOES match, return an object with the variables from the template, like { postId: "abc" }.
 * If it does NOT match, return null.
 * 
 * General examples:
 *      // one variable
 *      matchTemplateAndPath('/posts/{postId}.json', '/posts/abc.json') --> { postId: 'abc' }
 *      matchTemplateAndPath('/posts/{postId}.json', '/nope') --> null
 * 
 *      // multiple variables
 *      matchTemplateAndPath('/posts/{category}/{postId}.json', '/posts/gardening/abc.json')
 *          --> { category: 'gardening', postId: 'abc' }
 * 
 *      // no variables
 *      matchTemplateAndPath('/hello.txt', '/hello.txt') --> { }
 *      matchTemplateAndPath('/hello.txt', '/nope') --> null
 * 
 * A template can have zero variables; in this case we return {} if the template is identical
 * to the path, or null if it's different.
 * 
 * A path must have at least one character to fill the variable with.
 *   Example: template: '/posts/{postId}.json'
 *                path: '/posts/.json' will not match because the variable would be empty.
 * 
 * Variables can't span across path segments (they won't match '/' characters)
 *   Example: template: '/posts/{postId}.json'
 *                path: '/posts/123/456.json' will not match because there's a '/' in the way.
 * 
 * Variable names must only contain upper or lower case letters, numbers, or underscores.
 * They must not start with a number.
 */
export let matchTemplateAndPath = (template: string, path: string): Record<string, string> | null => {
    // if template has no variables, just compare it directly with the path
    // and avoid all this regex nonsense
    if (template.indexOf('{') === -1 && template.indexOf('}') === -1) {
        return (template === path ? {} : null);
    }
    // this also returns { varnames } but we don't use it here
    let { pathMatcherRe } = _templateToPathMatcherRegex(template);
    return _matchRegexAndPath(pathMatcherRe, path);
}
