import { ValidationError } from "../util/errors.ts";
import { Query, QueryFilter } from "../query/query-types.ts";
import { countChars, isObjectEmpty, replaceAll } from "../util/misc.ts";
import { Logger, LogLevel, setLogLevel } from "../util/log.ts";
import { Replica } from "../replica/replica.ts";
import {
  DefaultFormats,
  FormatDocType,
  FormatsArg,
} from "../formats/format_types.ts";

let logger = new Logger("query helpers", "gold");

//================================================================================
// HELPERS

/** Escape a string so it's safe to use in a regular expression.
 * (Put a backslash in front of each special regex character
 *  so the string won't trigger any regex behavior).
 */
const escapeRegex = /[.*+?^${}()|[\]\\]/g;

export function escapeStringForRegex(s: string): string {
  // Javascript regex syntax characters:
  // https://tc39.es/ecma262/#prod-SyntaxCharacter
  //    ^ $ \ . * + ? ( ) [ ] { } |
  return s.replace(escapeRegex, "\\$&"); // $& means the whole matched string
}

// same as string.matchAll(regex) which is only supported in node 12+
// returns [{
//    0: full match,
//    1: group part of the match,
//    index: number,
//    input: string,
//    groups: undefined
// }, {}, ...]
export let _matchAll = (re: RegExp, str: string): RegExpExecArray[] => {
  if (re.flags.indexOf("g") === -1) {
    throw new TypeError('matchAll requires a regex with the "g" flag set');
  }
  let matches: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    matches.push(m);
  }
  return matches;
};

//================================================================================
// GLOBS

/** A helper used by globToQueryAndRegex -- see that function for details.
 *
 *  This function simply turns a glob string into a regex.
 *  The other function calls this one, but sometimes discards the regex
 *   if it's not needed because it can make a good enough Earthstar query.
 */
export let globToRegex = (
  glob: string,
  forceEntireMatch: boolean = true,
): string => {
  // Just turn a glob into a regex.
  // '/hello/**/world/*.txt' --> '/hello/.*/world/[^/]*.txt'
  // forceEntireMatch: make the regex match all way from beginning to end of string
  // by surrounding it in ^ and $.

  // Three stars in a row are not allowed - throw
  if (glob.indexOf("***") !== -1) {
    throw new ValidationError(
      "invalid glob query has three stars in a row: " + glob,
    );
  }
  // Convert the glob into a regex.
  // First replace * and ** with characters that are not allowed in earthstar strings,
  // and are also not regex control characters...
  let regex = replaceAll(glob, "**", ";");
  regex = replaceAll(regex, "*", "#");
  // Then escape the string for regex safety...
  regex = escapeStringForRegex(regex);
  // Then finally replace the standin characters with active regex pieces.
  regex = replaceAll(regex, ";", ".*"); // any characters
  regex = replaceAll(regex, "#", "[^/]*"); // anything but slashes
  // Force the regex to match all way from beginning to end of string
  if (forceEntireMatch) {
    regex = "^" + regex + "$";
  }
  return regex;
};

/** Helper for querying Earthstar docs using a glob-style query string.
 *
 * Given a glob string, return:
 *    - an earthstar Query
 *    - and a regular expression (as a plain string, not a RegExp instance).
 *
 * Glob strings support '*' and '**' as wildcards.
 * '**' matches any sequence of characters at all including slashes.
 * '*' matches any sequence of characters except a forward slash --
 *  it does not span directories in the path.
 * Your glob string may have multiple asterisks in various positions,
 *  except they cannot be directly adjecent to each other (no '***' should
 *  ever occur -- this will cause a ValidationError to be thrown).
 *
 * Note that no other wildcards are supported, unlike Bash globs.
 *
 * To use this function, run the query yourself and apply the regex
 * as a filter to the paths of the resulting documents,
 *  to get only the documents whose paths match the glob.
 * The regex will be null if it's not needed (if the query is
 *  strong enough to get the job done by itself).
 *
 * The returned query will use some subset of
 *  the `path`, `pathStartsWith`, and `pathEndswith` properties,
 *  and no other properties.
 *
 * Example glob strings:
 *
 *     "/posts/*ing/*.json" matches "/posts/sailing/12345.json"
 *
 *     "/posts/**.json"     matches "/posts/sailing/12345.json"
 *                              and "/posts/a/b/c/d/e/f/g/12345.json"
 *                              and "/posts/.json"
 *
 *     "**"                 matches every possible path
 *
 * To use it:
 *
 *    let queryByGlob = async (replica: IReplica, glob: string): Promise<Doc[]> => {
 *       let { query, regex } = globToQueryAndRegex(glob);
 *
 *       let docs = await replica.queryDocs(query);
 *       if (regex != null) {
 *           let re = new RegExp(regex);
 *           docs = docs.filter(doc => re.test(doc.path));
 *       }
 *       return docs;
 *    }
 *
 *    let posts = await queryByGlob(myReplica, '/posts/*.txt');
 */
export let globToQueryAndRegex = (
  glob: string,
): { query: Query<string[]>; regex: string | null } => {
  // Turn a glob into a query and an optional regex, if a regex is needed.

  // If no stars at all, this is just a direct path query.
  if (glob.indexOf("*") === -1) {
    return { query: { filter: { path: glob } }, regex: null };
  }

  // Get the parts of the glob before the first star and after the last star.
  // These will become our pathStartWith and pathEndsWith query paramters.
  let globParts = glob.split("*");
  let firstPart = globParts[0];
  let lastPart = globParts[globParts.length - 1];

  // Put startsWith and endsWith into the filter if needed
  let filter: QueryFilter = {};
  let query: Query<string[]> = {};

  if (firstPart) filter.pathStartsWith = firstPart;
  if (lastPart) filter.pathEndsWith = lastPart;

  // Special case for "**foo" or "foo**" -- no regex is needed for these,
  // we can rely completely on pathStartsWith or pathEndsWith
  let regex: string | null = "?";
  if (globParts.length === 3) {
    let [a, b, c] = globParts;
    if (a === "" && b === "") regex = null;
    if (b === "" && c === "") regex = null;
  }
  // special case did not apply, calculate the regex
  if (regex === "?") {
    regex = globToRegex(glob);
  }

  // We only want to add the filter to the query if the filter IS NOT empty.
  if (!isObjectEmpty(filter)) {
    query.filter = filter;
  }

  return { query, regex };
};

//================================================================================
// GLOB: USER-FACING API CALLS

/** Find documents whose path matches the glob string.
 * See documentation for globToQueryAndRegex for details on glob strings.
 *
 * You can specify additional query options by providing a `moreQueryOptions` object.
 * For example, you might want to set { contentLengthGt: 0 } to skip documents
 * with empty content (e.g. "deleted" documents).
 *
 * `moreQueryOptions` will override the glob's query, so it's best to avoid setting
 * `path`, `pathStartsWith` or `pathEndsWith` in your moreQueryOptions unless you
 * intend to override the glob's query.
 */
export async function queryByGlob<F = DefaultFormats>(
  replica: Replica,
  glob: string,
  moreQueryOptions: Omit<Query<[string]>, "formats"> = {},
  formats?: FormatsArg<F>,
): Promise<FormatDocType<F>[]> {
  let { query, regex } = globToQueryAndRegex(glob);
  query = { ...query, ...moreQueryOptions };
  let docs = await replica.queryDocs(query, formats);

  if (regex !== null) {
    let re = new RegExp(regex);
    docs = docs.filter((doc) => re.test(doc.path));
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

interface ParsedTemplate {
  template: string;
  varNames: string[]; // the names of the variables, in the order they occur, without brackets
  glob: string; // the template with all the variables replaced by '*'
  namedCaptureRegex: string; // a regex string that will match paths and do named captures of the variables
}
/** This is a low-level helper for the template matching code; probably don't use it directly.
 *
 *  Given a template, parse it and return:
 *  - a list of variable names
 *  - a glob for searching Earthstar using queryByGlob()
 *  - a regular expression with named capture groups which can extract the
 *     values of the variables from a path.
 *
 *  A variable in the template is any alphanumeric chars or underscores, in curly braces
 *   like {example} or {__EXAMPLE__} or {example_1}, starting with a non-number.
 *
 *  Templates can also contain * and ** according to the glob rules.
 *   Those wildcards are not counted as variables but are allowed to expand during the
 *   regex phase.
 *
 *  Rules for templates:
 *  - Variable names must only contain upper and lower letters, numbers, and underscore.
 *  - They cannot start with a number.
 *  - They cannot be empty {}.
 *  - Two variables cannot be directly touching {like}{this}.
 *  - A variable cannot be directly touching a star {likeThis}* or *{likeThis}.
 *
 *  If variable names don't match these rules, a ValidationError will be thrown.
 */
export function parseTemplate(template: string): ParsedTemplate {
  //--------------------------------------------------------------------------------
  // VALIDATE TEMPLATE and extract variable names

  if (template.indexOf("}{") !== -1) {
    throw new ValidationError(
      "template is not allowed to have to adjacent variables {like}{this}",
    );
  }

  if (template.indexOf("*{") !== -1 || template.indexOf("}*") !== -1) {
    throw new ValidationError(
      "template cannot have a star touching a variable *{likeThis}",
    );
  }

  let numLBrackets = countChars(template, "{");
  let numRBrackets = countChars(template, "}");
  if (numLBrackets !== numRBrackets) {
    throw new ValidationError("unbalanced curly braces");
  }

  let bracketVarRe = /\{(.*?)\}/g; // match and capture anything in curly braces, lazily, to get smallest matches
  let validVarName = /^[a-zA-Z_][a-zA-Z0-9_]*$/; // requirement for variable names: (alpha alphanum*)

  let varMatches = _matchAll(bracketVarRe, template);
  // capture anything in braces...
  let varNames = varMatches.map((match) => match[1]);
  // ...then check if it's a valid variable name, and throw errors if it's not
  for (let varName of varNames) {
    if (!validVarName.test(varName)) {
      throw new ValidationError(
        "variable name in template is not valid.  can only contain alphanumeric and underscore, and not start with number",
      );
    }
  }
  if (numLBrackets !== varNames.length || numRBrackets !== varNames.length) {
    throw new ValidationError("weird curly brace mismatch, maybe }backwards{");
  }

  // check for duplicate varNames
  let varNamesSet = new Set(varNames);
  if (varNamesSet.size !== varNames.length) {
    throw new ValidationError("variable names may not be repeated");
  }

  //--------------------------------------------------
  // MAKE GLOB VERSION

  // replace all the {vars} with *
  let glob = template.replace(bracketVarRe, "*");

  //--------------------------------------------------------------------------------
  // MAKE PATH REGEX

  // normally we would put each path part through escapeStringForRegex()...
  // but we want to allow stars to be mixed in with template variables,
  // so instead we use globToRegex() with false to prevent it from
  // wrapping each part in ^ and $.
  let parts: string[] = [];
  if (varMatches.length === 0) {
    parts.push(globToRegex(template, false));
  }
  for (let ii = 0; ii < varMatches.length; ii++) {
    let bracketMatch = varMatches[ii];
    let varName = bracketMatch[1];
    let matchStart = bracketMatch.index;
    let matchEnd = bracketMatch.index + bracketMatch[0].length;

    if (ii === 0) {
      let begin = template.slice(0, matchStart);
      parts.push(globToRegex(begin, false));
    }

    // make a regex to capture the actual value of this variable in a path
    let reForThisVariable = "(?<" + varName + ">[^/]*)";
    parts.push(reForThisVariable);

    if (ii <= varMatches.length - 2) {
      let nextMatch = varMatches[ii + 1];
      let between = template.slice(matchEnd, nextMatch.index);
      parts.push(globToRegex(between, false));
    } else {
      let end = template.slice(matchEnd);
      parts.push(globToRegex(end, false));
    }
  }
  let namedCaptureRegex = "^" + parts.join("") + "$";

  return {
    template,
    varNames,
    glob,
    namedCaptureRegex,
  };
}

/*
 *  This is a low-level helper for the template matching code; probably don't use it directly.
 *  See extractTemplateVariablesFromPath for more details.
 *
 *  Given a namedCaptureRegex (made from a template using parseTemplate),
 *   check if a given Earthstar path matches it.
 *  If it does match, return an object with the variables from the template.
 *  If it does not match, return null.
 *  A template can have zero variables; in this case we return {} on match and null on no match.
 */
export let extractTemplateVariablesFromPathUsingRegex = (
  namedCaptureRegex: string,
  path: string,
): Record<string, string> | null => {
  const matches2 = path.match(new RegExp(namedCaptureRegex));
  if (matches2 === null) return null;
  return { ...matches2.groups };
};

/*
 * Compare template strings to actual paths and extract the variables from the paths.
 * You can also use this to check if a template matches a path.
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
 * Zero-length matches are allowed.
 *   Example: template: '/posts/{postId}.json'
 *                path: '/posts/.json' matches, and will be { postId: '' }
 *
 * Variables can't span across path segments (they won't match '/' characters)
 *   Example: template: '/posts/{postId}.json'
 *                path: '/posts/123/456.json' will not match because there's a '/' in the way.
 *
 * Variable names must only contain upper or lower case letters, numbers, or underscores.
 * They must not start with a number.
 *
 * Variable names can't be repeated; each must be unique.
 *
 * Template strings can also contain * and **; these are not counted as variables but do
 *  help determine if the overall path matches the template.  See the glob functions
 *  for details on how those wildcards work.
 */
export let extractTemplateVariablesFromPath = (
  template: string,
  path: string,
): Record<string, string> | null => {
  // if template has no variables, just compare it directly with the path and avoid all this regex nonsense
  if (template.indexOf("{") === -1 && template.indexOf("}") === -1) {
    return (template === path ? {} : null);
  }
  // this also returns { varnames, glob } but we don't use them here
  let { namedCaptureRegex } = parseTemplate(template);
  return extractTemplateVariablesFromPathUsingRegex(namedCaptureRegex, path);
};

/*
 * Replace some template variables with their actual values.
 *
 * You can have extra variables that are not used in the template (they are ignored)
 * and you can omit some of the variables in the template (they will remain
 * as {bracketed} variables in the output).
 *
 * Note that variables should not be repeated in the template string; doing so will
 * result in the second copy being not replaced (and will also break the other
 * template query functions).
 *
 * You can also insert '*' as a value into a template, if you need to for some reason.
 *
 * let vars = { category: 'gardening', okToHaveExtra: 'notUsedVariables' },
 * let template = '/posts/{category}/{postId}.json';
 * insertVariablesIntoTemplate(vars, template) === '/posts/gardening/{postId}.json'
 */
export let insertVariablesIntoTemplate = (
  vars: Record<string, string>,
  template: string,
): string => {
  for (let [varName, value] of Object.entries(vars)) {
    template = template.replace("{" + varName + "}", value);
  }
  return template;
};

//================================================================================
// TEMPLATE: USER-FACING API CALLS

/** Given a template string like "/posts/{postId}.json",
 *  query the replica for docs with matching paths.
 *
 * See the docs for matchTemplateAndPath for details on template strings.
 *
 * You can get the variables out of your document paths like this:
 *
 *      let template = '/posts/{postId}.json';
 *      let docs = await queryByTemplate(myReplica, template);
 *      for (let doc of docs) {
 *          // vars will be like { postId: 'abc' }
 *          let vars = extractTemplateVariablesFromPath(template, doc.path);
 *      }
 */

export async function queryByTemplate<F = DefaultFormats>(
  replica: Replica,
  template: string,
  moreQueryOptions: Omit<Query<[string]>, "formats"> = {},
  formats?: FormatsArg<F>,
): Promise<FormatDocType<F>[]> {
  let { glob } = parseTemplate(template);
  let { query, regex } = globToQueryAndRegex(glob);
  query = { ...query, ...moreQueryOptions };

  let docs = await replica.queryDocs(query, formats);
  if (regex != null) {
    let re = new RegExp(regex);
    docs = docs.filter((doc) => re.test(doc.path));
  }
  return docs;
}
