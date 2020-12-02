import {
    EarthstarError,
    NotFoundError,
    StorageIsClosedError,
    ValidationError,
    isErr,
} from '../util/types';
import { AsyncResource } from 'async_hooks';


let logMain = (...args : any[]) => console.log('--MAIN: ', ...args);
let logCaller = (...args : any[]) => console.log('------CALLER: ', ...args);
let logEvaluator = (...args : any[]) => console.log('----------EVALUATOR: ', ...args);
let sleep = async (ms : number) : Promise<void> =>
    new Promise((resolve, reject) => setTimeout(resolve, ms));

//================================================================================
// TYPES

type Ob<T> = {[key:string]: T};
type Fn = (...args: any[]) => any;
type UnPromisify<T> = T extends Promise<infer U> ? U : T;

export class RPCError extends Error {
    constructor(message?: string) {
        super(message || 'JSON-RPC Error');
        this.name = 'RPCError';
    }
}

enum JErrorCode {
    PARSE_ERROR = -32700,
    INVALID_REQUEST = -32600,
    METHOD_NOT_FOUND = -32601,
    INVALID_PARAMS = -32602,
    INTERNAL_ERROR = -32603,
    RETURNED_ERROR = 1,      // an expected Error instance that was returned, not thrown, by the method
    METHOD_THREW_ERROR = 2,  // the method threw an Error
}

type Jid = string | number;  // the spec says this should also allow null

interface JRequest {
    jsonrpc: "2.0",
    id: Jid,
    method: string,
    params: Array<any>,  // the spec says this should be params?: Array<any> | Ob<any>
}
interface JNotification {
    jsonrpc: "2.0",
    // notifications have no id
    method: string,
    params?: Array<any>,
}
type JReqOrNotification = JRequest | JNotification;

interface JResponseSuccess {
    jsonrpc: "2.0",
    id: Jid,
    result: any,
}
interface JResponseError {
    jsonrpc: "2.0",
    id: Jid,
    error: JErrorDetails,
}
interface JErrorDetails {
    code: number,
    message: string,
    data?: any,
}
type JResponse = JResponseSuccess | JResponseError;

type JEvaluator = (req: JRequest) => Promise<JResponse>;

//================================================================================
// HELPERS
// for handling request and response objects

let makeId = () =>
    '' + Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);

let makeRes = (id: Jid, result: any): JResponse =>
    result instanceof Error ? makeResReturnedErr(id, result): makeResSuccess(id, result);
let makeResSuccess = (id: Jid, result : any): JResponseSuccess =>
    ({ jsonrpc: '2.0', id, result })
let makeResReturnedErr = (id: Jid, err: Error): JResponseError => ({
    // take any Error instance and serialize it
    jsonrpc: '2.0',
    id,
    error: {
        code: JErrorCode.RETURNED_ERROR,
        message: err.name,
        data: err.message,
    },
});
let makeResRpcErr = (id: Jid, code: JErrorCode, message: string = '') : JResponseError => ({
    // a low-level JSON-RPC related error
    jsonrpc: '2.0',
    id,
    error: {
        code: code,
        message: JErrorCode[code] + (message ? `: ${message}` : '')
    },
});

let extractResult = (res: JResponse, returnableErrors: any[]): any => {
    // if it's a successful response, return the result.
    // if it's a returned error, instantiate an actual Error class and return that.
    // otherwise throw RPCError if an unexpected error happens.
    //
    // returnableErrors: a list of errors (subclasses of Error) that methods are allowed to return (not throw).
    //
    if ('result' in res) { return res.result; }
    if ('error' in res) {
        // deserialize returned errors back into actual Error classes
        if (res.error.code === JErrorCode.RETURNED_ERROR) {
            for (let errorClass of returnableErrors) {
                if (res.error.message === errorClass.name) {
                    return new errorClass(res.error.data);
                }
            }
        }
        // it was not one of the expected returnable error classes, so make an RPCError
        throw new RPCError(res.error.code + ': ' + res.error.message + (res.error.data ? ' | ' + res.error.data : ''));
    }
    throw new RPCError('invalid RPC response missing both "result" and "error" properties');
}

//================================================================================
// JSON-RPC machinery

let makeBuildReq = <A>() =>
    // Make a "buildReq" function which, when called, generates a JSON-RPC request object.
    // A: an interface of the API methods.
    // Example:
    //   let buildReq = makeBuildReq<MyApiInterface>();
    //   let req = buildReq('add', 1, 2);
    // (This would be nicer as a single function, if I could have gotten the generic types to work:)
    //   let req = nicerBuildReq<MyApiInterface>('add', 1, 2);
    <MN extends keyof A>(methodName: MN, ...args: Parameters<A[MN] extends Fn ? A[MN] : never>): JRequest =>
        ({
            jsonrpc: '2.0',
            id: makeId(),
            params: args,
            method: methodName as string,
        });

let makeLocalEvaluator = (apiImplementation: any): JEvaluator =>
    // Return an evaluator function which process request objects into response objects.
    // This particular one just calls methods on the local machine.
    // There could be other versions of this function that call over HTTP, etc.
    // Example:
    //   let evaluator = makeLocalEvaluator(apiImplementation);
    //   let response = await evaluator(request)
    async (req: JRequest): Promise<JResponse> => {
        // guard against malformed requests
        if (typeof req.method !== 'string') {
            return makeResRpcErr(req.id, JErrorCode.INVALID_REQUEST, 'method must be a string');
        }
        if (typeof req.id !== 'string' && typeof req.id !== 'number') {
            return makeResRpcErr(req.id, JErrorCode.INVALID_REQUEST, 'id must be a string or number');
        }
        if (!Array.isArray(req.params)) {
            return makeResRpcErr(req.id, JErrorCode.INVALID_REQUEST, 'params must be an array');
        }

        // get method
        logEvaluator('evaluating:', req.method);
        let method = apiImplementation[req.method] as Fn;
        logEvaluator('method:', method);
        if (method === undefined) {
            return makeResRpcErr(req.id, JErrorCode.METHOD_NOT_FOUND, req.method);
        }

        // check for wrong number of params.
        // TODO: maybe allow cases where method has more params than the request, to allow methods with optional params
        if (method.length !== req.params.length) {
            return makeResRpcErr(req.id, JErrorCode.INVALID_PARAMS, `for method ${req.method}, expected ${method.length} params but got ${req.params.length}: ${JSON.stringify(req.params)}`);
        }

        // actually call the method
        let result: any;
        try {
            result = method(...req.params);
            // resolve promise, if it is one
            if (result instanceof Promise) {
                logEvaluator('awaiting async method...');
                result = await result;
            }
            logEvaluator('result:', result);
        } catch (err) {
            // the method itself threw an exception
            logEvaluator('method throw an exception');
            return makeResRpcErr(req.id, JErrorCode.METHOD_THREW_ERROR, `${err.name}: ${err.message}`);
        }

        // build response object
        let res = makeRes(req.id, result);
        // do a JSON roundtrip to simulate what would happen on a network,
        // to make sure we're only returning basic types
        res = JSON.parse(JSON.stringify(res));
        logEvaluator('response:', res);
        return res;
    };

let makeCaller = <A>(evaluator: JEvaluator, returnableErrors: any[]) =>
    // A: an interface of the API methods.
    // returnableErrors: a list of errors (subclasses of Error) that methods are allowed to return (not throw).
    //
    // Make a caller function that kicks off a full RPC roundtrip.
    // It hides all the RPC business and looks just like a regular local function with
    // the same type as the original method.
    // This is async because it might have to wait for the network.
    // Feed it an evaluator function which is responsible for running the actual methods locally
    // or getting the results from across the network.
    // Example:
    //   let evaluator = makeLocalEvaluator(apiImplementation);
    //   let caller = makeCaller<MyApiInterface>(evaluator, returnableErrors);
    //   let result = await caller('add', 1, 2);
    //
    // This can throw an RPCError if...
    //    network problems
    //    wrong number of method params
    //    unknown method name
    //    the method throws an error (it will end up as an RPCError over on this side)
    // 
    // If the method returns (not throws) an error instance of an expected type (returnableErrors),
    // this will return an actual instance of that error (not throw it).
    //
    // The return type of this function is complicated.  Here's how it works:
    // There are two reasons this could return a promise:
    // - The original API method might be async, returning a promise, or it might not.
    // - The RPC evaluation is always async, adding another layer of promise
    // So this would normally be either Promise<foo> or Promise<Promise<foo>>.
    // However, if the API method is async its promise would have already been resolved on the
    // server side, so we want this to always be just one layer deep: Promise<foo>.
    // We express this as Promise<UnPromisify<foo>> -- the UnPromisify will unwrap a promise type
    // or leave it alone if it's not a promise.
    async <MN extends keyof A>(
            // method name is a key of A
            methodName: MN,
            // args is the parameters of the corresponding function in A.
            // The "extends..." is needed to convince Typescript that it's always a function.
            ...args: Parameters<A[MN] extends Fn ? A[MN] : never>
        ): Promise<UnPromisify<ReturnType<A[MN] extends Fn ? A[MN] : never>>> => {

        logCaller('calling:', methodName);
        let buildReq = makeBuildReq<A>();
        let req: JRequest = buildReq(methodName, ...args);
        logCaller('request:', req);
        let res: JResponse = await evaluator(req);
        logCaller('response:', res);
        if (req.id !== res.id) {
            throw new RPCError(`request id ${req.id} does not match response id ${res.id}`);
        }
        let result = extractResult(res, returnableErrors);
        logCaller('result:', result);
        return result;
    };

//================================================================================
// MAIN

// Example API for demo purposes:
// The types...
interface ApiTypes {
    zero(): number,
    add(a: number, b: number): number,
    addSlowly(a: number, b: number): Promise<number>,
    double(a: number): number,
    toString(a: number): string,
    returnErr(): ValidationError,
    throwErr(): number,
}

// The actual code:
let apiImplementation : ApiTypes = {
    zero: () => 0,
    add: (a: number, b: number) => a + b,
    addSlowly: async (a: number, b: number) => {
        await sleep(1000);
        return a + b;
    },
    double: (a: number) => a * 2,
    toString: (a: number) => '' + a,
    returnErr: () => new ValidationError('this was an expected error'),
    throwErr: () => { throw new Error('unexpected error') },
}

// And the kinds of Error subclasses that methods are allowed to directly return (not throw).
// These get special handling.
// Other errors (and any errors that are actually thrown) will be re-thrown on the client side.
let returnableErrorClasses = [
    ValidationError,
    StorageIsClosedError,
    NotFoundError,
    EarthstarError,
]

let main = async () => {
    // Make an "evaluator" which takes JSON-RPC request objects and makes response objects.
    // This one works by running the actual method locally, but there could be another
    // version that sends the requests across the network and gets response objects back.
    let evaluator = makeLocalEvaluator(apiImplementation);

    // Make a "caller" which hides all the JSON-RPC stuff
    // and lets us call it as if it was the original method;
    // converts JSON-RPC errors into regular thrown Errors, etc.
    let caller = makeCaller<ApiTypes>(evaluator, returnableErrorClasses);

    logMain('===========================================');
    let a = await caller('add', 1, 2);
    logMain(a);



    // more tests

    //console.log('\n');
    //logMain('===========================================');
    //let b = await caller('addSlowly', 1, 2);
    //logMain(b);

    //console.log('\n');
    //logMain('===========================================');
    //let c = await caller('returnErr');
    //logMain(c);

    //console.log('\n');
    //logMain('===========================================');
    //try {
    //    let d = await caller('throwErr');
    //    logMain(d);
    //} catch (err) {
    //    logMain('method threw an error:', err);
    //}

    //console.log('\n');
    //logMain('===========================================');
    //try {
    //    let e = await caller('nope' as any);
    //    logMain(e);
    //} catch (err) {
    //    logMain('tried to call nonexistant method:', err);
    //}

    //console.log('\n');
    //logMain('===========================================');
    //try {
    //    let f = await (caller as any)('add', 1, 2, 3, 4, 5, 6);
    //    logMain(f);
    //} catch (err) {
    //    logMain('too many params', err);
    //}

    //console.log('\n');
    //logMain('===========================================');
    //try {
    //    let f = await (caller as any)('add', 1);
    //    logMain(f);
    //} catch (err) {
    //    logMain('not enough params', err);
    //}

    //console.log('\n');
    logMain('done');

    //await caller('double', 1);
    //await caller('add', 1, 2);
    //await caller('toString', 1);

    //let buildReq = makeBuildReq<ApiTypes>();
    //buildReq('zero')
    //buildReq('double', 1)
    //buildReq('add', 1, 2)
    //buildReq('toString', 1)

    //// should be errors:
    //buildReq('add', 1, 2, 3);
    //buildReq('?', 1);
    //await caller('add', 1, 2, 3);
    //await caller('?', 1);
};
main();








