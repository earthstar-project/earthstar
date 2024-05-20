/** Generic top-level error class that other Earthstar errors inherit from. */
export class EarthstarError extends Error {
  /** Construct a new EarthstarError. */
  constructor(message?: string) {
    super(message || "");
    this.name = "EarthstarError";
  }
}

/** Validation failed on a document, share address, author address, etc. */
export class ValidationError extends EarthstarError {
  /** Construct a new ValidationError. */
  constructor(message?: string) {
    super(message || "Validation error");
    this.name = "ValidationError";
  }
}

/** Authorisation failed on an attempted document write, cap delegation, etc. */
export class AuthorisationError extends EarthstarError {
  /** Construct a new AuthorisationError. */
  constructor(message?: string) {
    super(message || "Authorisation error");
    this.name = "AuthorisationError";
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
