import {
    Document,
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

/*
 * Helper for querying Earthstar docs using a glob-style query string.
 *
 * Given a glob string, return:
 *    - an earthstar Query
 *    - and a regular expression (as a plain string, not a RegExp instance).
 * 
 * The glob string only supports '*' as a wildcard.
 * You can use multiple '*' in any position in the query.
 * There are no other special wildcards like '?' or '**' as in Bash.
 * '**' will act the same as '*'.
 * 
 * The asterisk is allowed to match across multiple path segments (e.g. it can
 * include slashes): '/hello/*.txt' can match '/hello/deeply/nested/path.txt'.
 * 
 * To use this function, run the query yourself and apply the regex
 * as a filter to the paths of the resulting documents,
 * to get only the documents whose paths match the glob.
 * The regex will be null if it's not needed.
 *
 * Example usage:
 *
 *   let queryByGlob = (storage: IStorage, glob: string): Document[] => {
 *      let { query, pathRegex } = globToEarthstarQueryAndPathRegex(glob);
 * 
 *      let docs = storage.documents(query);
 *      if (pathRegex != null) {
 *          let re = new RegExp(pathRegex);
 *          docs = docs.filter(doc => re.test(doc.path));
 *      }
 *      return docs;
 *   }
 * 
 *   let posts = queryByGlob(myStorage, '/posts/*.txt');
 * 
 */
export let globToEarthstarQueryAndPathRegex = (glob: string): { query: Query, pathRegex: string | null } => {
    let parts = glob.split('*');
    let query: Query = {};
    let pathRegex = null;

    if (parts.length === 1) {
        // The glob has no wildcards, and the path is completely defined.
        query = {
            ...query,
            path: glob,
        };
    } else {
        // The glob has wildcard(s) within it.
        query = {
            ...query,
            pathStartsWith: parts[0],
            pathEndsWith: parts[parts.length - 1],
        };
        // Make a regex to enforce the glob.
        pathRegex = '^' + parts.map(escapeStringForRegex).join('.*') + '$';

        // Optimize some special cases:

        // If the glob starts or ends with a wildcard, the first or last part
        // will just be empty strings
        // and we can trim them from the query.
        if (query.pathStartsWith === '') {
            delete query.pathStartsWith;
        }
        if (query.pathEndsWith === '') {
            delete query.pathEndsWith;
        }

        // Special case for '*foo' or 'foo*' -- no regex is needed,
        // we can just rely on pathStartsWith or pathEndsWith to do all the work.
        if (parts.length === 2 && (parts[0] === '' || parts[parts.length-1] === '')) {
            pathRegex = null;
        }
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
 * If `moreQueryOptions` has `path`, `pathStartsWith`, and/or `pathEndsWith` properties,
 * those will be overridden as needed to satisfy the glob query, so it's best not to
 * set those yourself.
 */
export let queryByGlobSync = (storage: IStorage, glob: string, moreQueryOptions: Query = {}): Document[] => {
    let { query, pathRegex } = globToEarthstarQueryAndPathRegex(glob);
    query = { ...moreQueryOptions, ...query };
 
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
 * If `moreQueryOptions` has `path`, `pathStartsWith`, and/or `pathEndsWith` properties,
 * those will be overridden as needed to satisfy the glob query, so it's best not to
 * set those yourself.
 */
export let queryByGlobAsync = async (storage: IStorage | IStorageAsync, glob: string, moreQueryOptions: Query = {}): Promise<Document[]> => {
    let { query, pathRegex } = globToEarthstarQueryAndPathRegex(glob);
    query = { ...moreQueryOptions, ...query };
 
    let docs = await storage.documents(query);
    if (pathRegex != null) {
        let re = new RegExp(pathRegex);
        docs = docs.filter(doc => re.test(doc.path));
    }
    return docs;
}
