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
}

let replaceAll = (str: string, from: string, to: string): string => {
    return str.split(from).join(to);
}

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
