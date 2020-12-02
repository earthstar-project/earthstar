import {
    EarthstarError,
    NotFoundError,
    StorageIsClosedError,
    ValidationError,
    isErr,
} from '../util/types';
import { IncomingMessage } from 'http';

let logMain = (...args : any[]) => console.log('--MAIN: ', ...args);
let logClient = (...args : any[]) => console.log('------CLIENT: ', ...args);
let logEvaluator = (...args : any[]) => console.log('----------EVALUATOR: ', ...args);

//================================================================================
// TYPES

type Ob<T> = {[key:string]: T};
type Fn = (...args: any[]) => any;

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
    RETURNED_ERROR = 1,
}

type Jid = string | number;  // should also allow null

interface JRequest {
    jsonrpc: "2.0",
    id: Jid,
    method: string,
    params: Array<any>,  // should be params?: Array<any> | Ob<any>
}
interface JNotification {
    jsonrpc: "2.0",
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
    error: JError,
}
interface JError {
    code: number,
    message: string,
    data?: any,
}
type JResponse = JResponseSuccess | JResponseError;

type JEvaluator = (req: JRequest) => JResponse;

//================================================================================

// An imaginary class we want to expose over RPC
interface IPub {
    workspaces: string[];
    hashedWorkspaces(nonce: string): string[] | ValidationError;
    echo(v: string): string;
}

// The actual implementation of the class
class Pub implements IPub {
    workspaces: string[];
    constructor(workspaces: string[]) {
        this.workspaces = workspaces;
    }
    hashedWorkspaces(nonce: string): string[] | ValidationError {
        if (nonce === 'bad') { return new ValidationError('returned error: bad nonce'); }
        if (nonce === '') { throw new Error('thrown error: empty nonce'); }
        return this.workspaces.map(w => w + nonce);
    }
    echo(v : string): string { return v; }
}

//================================================================================
// HELPERS

// requests
let makeId = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
let makeReq = (method: string, params: Array<any>): JRequest =>
    ({ jsonrpc: '2.0', id: makeId(), method, params });

// responses
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

let errorClasses = [
    ValidationError,
    StorageIsClosedError,
    NotFoundError,
    EarthstarError,
]
let extractResult = <T>(res: JResponse) : T | RPCError => {
    if ('result' in res) { return res.result as T; }
    if ('error' in res) {
        // deserialize errors back into actual Error classes
        if (res.error.code === JErrorCode.RETURNED_ERROR) {
            for (let errorClass of errorClasses) {
                if (res.error.message === errorClass.name) {
                    return new errorClass(res.error.data);
                }
            }
        }
        return new RPCError(res.error.code + ': ' + res.error.message + ' | ' + res.error.data);
    }
    return new RPCError('invalid RPC response missing both "result" and "error" properties');
}

//================================================================================

let makeLocalEvaluator = (methods: {[key:string]: Fn}): JEvaluator =>
    (req: JRequest): JResponse => {
        logEvaluator('method name', req.method);
        if (req.method in methods) {
            let actualMethod: Fn = (methods as any)[req.method];
            logEvaluator('actual method:', actualMethod);
            try {
                logEvaluator('calling...');
                let result = actualMethod(...req.params);
                logEvaluator('result:', result);
                return makeRes(req.id, result);
            } catch (e) {
                logEvaluator('caught error:', e.name, e.message);
                return makeResRpcErr(req.id, JErrorCode.INTERNAL_ERROR, e.name + ': ' + e.message);
            }
        }
        logEvaluator('method not found, returning METHOD_NOT_FOUND');
        return makeResRpcErr(req.id, JErrorCode.METHOD_NOT_FOUND);
    }


let makeLocalCaller = (evaluator: JEvaluator, methods: {[key: string]: Fn}) =>
    <M extends Fn>(method: M, ...args: Parameters<M>): ReturnType<M> | RPCError => {
        logClient('call from client', method.name, args);
        logClient('finding method name');
        let methodName = '';
        for (let [k,v] of Object.entries(methods)) {
            if (v === method) { methodName = k; break; }
        }
        if (methodName === '') { return new RPCError('method not found in local method list: ' + method) }
        logClient('method name:', methodName);
        let req: JRequest = makeReq(methodName, args);
        logClient('req:', req);
        let res: JResponse = evaluator(req);
        logClient('res:', res);
        let result = extractResult<ReturnType<M>>(res);
        logClient('result:', result);
        return result;
    }

let directCaller = <M extends Fn>(method: M, ...args: Parameters<M>): ReturnType<M> =>
    method(...args);

//================================================================================
// MAIN

// setup methods
let pub = new Pub(['aaa', 'zzz']);
interface IMethods {
    hashedWorkspaces: IPub['hashedWorkspaces']; //(nonce: string) => string[] | ValidationError,
    echo: IPub['echo'];
    //[key:string]: Fn; // this is needed to make Typescript happy
}
let actualMethods = {
    hashedWorkspaces: pub.hashedWorkspaces.bind(pub),
    echo: pub.echo.bind(pub),
}

/*
type FnMap = {[k:string]: Fn};
let tempCaller = <IM, MS extends keyof IM>(methodName: MS, ...args: IM extends FnMap ? Parameters<IM[MS]> : any) : ReturnType<IM[MS]> => {
    return 1 as any;
};
tempCaller<IMethods, 'echo'>('echo', 'a');
*/

// make rpc stuff
let evaluator = makeLocalEvaluator(actualMethods);
let caller = makeLocalCaller(evaluator, actualMethods);
//let caller = directCaller;

// use
logMain('==================================================== NORMAL');
logMain(caller(actualMethods.hashedWorkspaces, 'nonce1'));

logMain('==================================================== EXPECTED ERROR');
logMain(caller(actualMethods.hashedWorkspaces, 'bad'));

logMain('==================================================== UNEXPECTED ERROR');
logMain(caller(actualMethods.hashedWorkspaces, ''));

logMain('==================================================== METHOD NOT FOUND IN LOCAL METHODS LIST');
logMain(caller((s : string) => s, ''));



