
type Ob<T> = {[key:string]: T};
type Fn = (...args: any[]) => any;

//================================================================================

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
    SERIALIZED_ERROR = 501,
}

type Jid = string | number;  // should also allow null

interface JRequest {
    jsonrpc: "2.0",
    id: Jid,
    method: string,
    params: Ob<any>,  // should be params?: Array<any> | Ob<any>
}
interface JNotification {
    jsonrpc: "2.0",
    method: string,
    params?: Array<any> | Ob<any>,
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

type JServer = (req: JRequest) => JResponse;

//================================================================================
import { isErr, ValidationError } from '../util/types';

// An imaginary class we want to expose over RPC
interface IPub {
    workspaces: string[],
    hashedWorkspaces(nonce: string): string[] | ValidationError
}

// The actual implementation of the class
class Pub implements IPub {
    workspaces: string[];
    constructor(workspaces: string[]) {
        this.workspaces = workspaces;
    }
    hashedWorkspaces(nonce: string): string[] | ValidationError {
        return this.workspaces.map(w => w.toUpperCase());  // lol
    }
}

// Requesting side
// Helpers for handling JSON-RPC objects
let makeId = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
let makeReq = (method: string, params: Ob<any>): JRequest =>
    ({ jsonrpc: '2.0', id: makeId(), method, params });
let extractResult = (res: JResponse) : any => {
    if ('result' in res) { return res.result; }
    if ('error' in res) {
        // deserialize errors into actual Error classes
        if (res.error.code === JErrorCode.SERIALIZED_ERROR) {
            if (res.error.message === 'ValidationError') { return new ValidationError(res.error.data); }
            //...
            //...
        }
        return new RPCError(res.error.code + ': ' + res.error.message + ' | ' + res.error.data);
    }
    return new RPCError('invalid RPC response missing both "result" and "error" properties');
}
// Make a JSON-RPC request object representing a method call
class PubRequestMaker {
    constructor() {}
    static hashedWorkspaces(nonce: string): JRequest {
        return makeReq('hashedWorkspaces', {nonce});
    }
}
// Full lifecycle: Make a request, send it to the server, decode the response, and return it.
class PubProxyClient {
    // server is a function that turns requests into responses
    server: JServer
    constructor(server: JServer) {
        this.server = server;
    }
    // can write out the return type by hand...
    hashedWorkspaces(nonce: string): string[] | ValidationError | RPCError {
        let req = PubRequestMaker.hashedWorkspaces(nonce);
        return extractResult(this.server(req));
    }
    // or can get it automatically
    hashedWorkspaces2(nonce: string): ReturnType<Pub['hashedWorkspaces']> | RPCError {
        let req = PubRequestMaker.hashedWorkspaces(nonce);
        return extractResult(this.server(req));
    }
}


// Serving side
// helpers for building response objects
let makeGenericErr = (id: Jid, code: JErrorCode) : JResponseError => ({
    // a low-level JSON-RPC related error
    jsonrpc: '2.0',
    id,
    error: {
        code: code,
        message: JErrorCode[code],
    },
});
let makeRespErr = (id: Jid, err: Error): JResponseError => ({
    // take any Error instance and serialize it
    jsonrpc: '2.0',
    id,
    error: {
        code: JErrorCode.SERIALIZED_ERROR,
        message: err.name,
        data: err.message,
    },
});
let makeRespSuccess = (id: Jid, result : any): JResponseSuccess =>
    ({ jsonrpc: '2.0', id, result })
let makeResp = (id: Jid, result: any): JResponse => {
    if (isErr(result)) { return makeRespErr(id, result); }
    return makeRespSuccess(id, result);
}

// The pub RPC server implementation
let makePubRpcServer = (pub: Pub): JServer =>
    (req: JRequest): JResponse => {
        // TODO: if req object is very bad, return INVALID_REQUEST
        try {
            if (req.method === 'hashedWorkspaces') {
                return makeResp(req.id, pub.hashedWorkspaces(req.params.nonce));
            }
            // if (... other methods here ) {
            //
            // }
            return makeGenericErr(req.id, JErrorCode.METHOD_NOT_FOUND);
        } catch (err) {
            return makeRespErr(req.id, err);
        }
    };

//================================================================================
// MAIN

// create a server
let myPub = new Pub([]);
let myServer = makePubRpcServer(myPub);

// use it from a client
let myProxy = new PubProxyClient(myServer);
let hashedWorkspaces = myProxy.hashedWorkspaces('nonceA');


// another way, with gymnastics to get Typescript to understand it
let callIt = <M extends Fn>(method: M, ...args: Parameters<M>): ReturnType<M> | RPCError => {
    // note myServer included in closure here, from above
    let req : JRequest = makeReq(method.name, args);
    let res : JResponse = myServer(req);
    return extractResult(res);
}

// aPub is only used to get the types of its methods.
// we're actually calling out to myPub here.
let fakePub = new Pub([]);
let hashedWorkspaces2 = callIt(fakePub.hashedWorkspaces, 'zzz');



