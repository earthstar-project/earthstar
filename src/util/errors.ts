/** Generic top-level error class that other Earthstar errors inherit from. */
/* istanbul ignore next */
export class EarthstarError extends Error {
    constructor(message?: string) {
        super(message || "");
        this.name = "EarthstarError";
    }
}

/** Validation failed on a document, workspace address, author address, etc. */
/* istanbul ignore next */
export class ValidationError extends EarthstarError {
    constructor(message?: string) {
        super(message || "Validation error");
        this.name = "ValidationError";
    }
}

/** An IStorageAsync or IStorageDriverAsync was used after close() was called on it. */
/* istanbul ignore next */
export class StorageIsClosedError extends EarthstarError {
    constructor(message?: string) {
        super(
            message || "a Storage or StorageDriver was used after being closed",
        );
        this.name = "StorageIsClosedError";
    }
}

/** A QueryFollower was used after close() was called on it. */
/* istanbul ignore next */
export class QueryFollowerIsClosedError extends EarthstarError {
    constructor(message?: string) {
        super(message || "a QueryFollower was used after being closed");
        this.name = "QueryFollowerIsClosedError";
    }
}

/* istanbul ignore next */
export class NotFoundError extends EarthstarError {
    constructor(message?: string) {
        super(message || "not found");
        this.name = "NotFoundError";
    }
}

/** A pub URL is bad or the network is down */
/* istanbul ignore next */
export class NetworkError extends EarthstarError {
    constructor(message?: string) {
        super(message || "network error");
        this.name = "NetworkError";
    }
}

/* istanbul ignore next */
export class TimeoutError extends EarthstarError {
    constructor(message?: string) {
        super(message || "timeout error");
        this.name = "TimeoutError";
    }
}

/** A pub won't accept writes */
/* istanbul ignore next */
export class ConnectionRefusedError extends EarthstarError {
    constructor(message?: string) {
        super(message || "connection refused");
        this.name = "ConnectionRefused";
    }
}

/* istanbul ignore next */
export class NotImplementedError extends EarthstarError {
    constructor(message?: string) {
        super(message || "not implemented yet");
        this.name = "NotImplementedError";
    }
}

/** Check if any value is a subclass of EarthstarError (return true) or not (return false) */
export function isErr<T>(x: T | Error): x is EarthstarError {
    return x instanceof EarthstarError;
}

/** Check if any value is a subclass of EarthstarError (return false) or not (return true) */
export function notErr<T>(x: T | Error): x is T {
    return !(x instanceof EarthstarError);
}
