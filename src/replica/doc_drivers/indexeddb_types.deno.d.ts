// Deno doesn't support IndexedDB yet so doesn't have the types for it.
// We could add these types by adding `dom` to compilerOption's lib property
// But then all downstream users would need that too.

/** This IndexedDB API interface represents a cursor for traversing or iterating over multiple records in a database. */
interface IDBCursor {
  /** Returns the direction ("next", "nextunique", "prev" or "prevunique") of the cursor. */
  readonly direction: IDBCursorDirection;
  /** Returns the key of the cursor. Throws a "InvalidStateError" DOMException if the cursor is advancing or is finished. */
  readonly key: IDBValidKey;
  /** Returns the effective key of the cursor. Throws a "InvalidStateError" DOMException if the cursor is advancing or is finished. */
  readonly primaryKey: IDBValidKey;
  readonly request: IDBRequest;
  /** Returns the IDBObjectStore or IDBIndex the cursor was opened from. */
  readonly source: IDBObjectStore | IDBIndex;
  /** Advances the cursor through the next count records in range. */
  advance(count: number): void;
  /** Advances the cursor to the next record in range. */
  continue(key?: IDBValidKey): void;
  /** Advances the cursor to the next record in range matching or after key and primaryKey. Throws an "InvalidAccessError" DOMException if the source is not an index. */
  continuePrimaryKey(key: IDBValidKey, primaryKey: IDBValidKey): void;
  /**
   * Delete the record pointed at by the cursor with a new value.
   *
   * If successful, request's result will be undefined.
   */
  delete(): IDBRequest<undefined>;
  /**
   * Updated the record pointed at by the cursor with a new value.
   *
   * Throws a "DataError" DOMException if the effective object store uses in-line keys and the key would have changed.
   *
   * If successful, request's result will be the record's key.
   */
  update(value: any): IDBRequest<IDBValidKey>;
}

declare var IDBCursor: {
  prototype: IDBCursor;
  new (): IDBCursor;
};

/** This IndexedDB API interface represents a cursor for traversing or iterating over multiple records in a database. It is the same as the IDBCursor, except that it includes the value property. */
interface IDBCursorWithValue extends IDBCursor {
  /** Returns the cursor's current value. */
  readonly value: any;
}

declare var IDBCursorWithValue: {
  prototype: IDBCursorWithValue;
  new (): IDBCursorWithValue;
};

interface IDBDatabaseEventMap {
  "abort": Event;
  "close": Event;
  "error": Event;
  "versionchange": IDBVersionChangeEvent;
}

/** This IndexedDB API interface provides a connection to a database; you can use an IDBDatabase object to open a transaction on your database then create, manipulate, and delete objects (data) in that database. The interface provides the only way to get and manage versions of the database. */
interface IDBDatabase extends EventTarget {
  /** Returns the name of the database. */
  readonly name: string;
  /** Returns a list of the names of object stores in the database. */
  readonly objectStoreNames: DOMStringList;
  onabort: ((this: IDBDatabase, ev: Event) => any) | null;
  onclose: ((this: IDBDatabase, ev: Event) => any) | null;
  onerror: ((this: IDBDatabase, ev: Event) => any) | null;
  onversionchange:
    | ((this: IDBDatabase, ev: IDBVersionChangeEvent) => any)
    | null;
  /** Returns the version of the database. */
  readonly version: number;
  /** Closes the connection once all running transactions have finished. */
  close(): void;
  /**
   * Creates a new object store with the given name and options and returns a new IDBObjectStore.
   *
   * Throws a "InvalidStateError" DOMException if not called within an upgrade transaction.
   */
  createObjectStore(
    name: string,
    options?: IDBObjectStoreParameters,
  ): IDBObjectStore;
  /**
   * Deletes the object store with the given name.
   *
   * Throws a "InvalidStateError" DOMException if not called within an upgrade transaction.
   */
  deleteObjectStore(name: string): void;
  /** Returns a new transaction with the given mode ("readonly" or "readwrite") and scope which can be a single object store name or an array of names. */
  transaction(
    storeNames: string | string[],
    mode?: IDBTransactionMode,
  ): IDBTransaction;
  addEventListener<K extends keyof IDBDatabaseEventMap>(
    type: K,
    listener: (this: IDBDatabase, ev: IDBDatabaseEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof IDBDatabaseEventMap>(
    type: K,
    listener: (this: IDBDatabase, ev: IDBDatabaseEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var IDBDatabase: {
  prototype: IDBDatabase;
  new (): IDBDatabase;
};

/** In the following code snippet, we make a request to open a database, and include handlers for the success and error cases. For a full working example, see our To-do Notifications app (view example live.) */
interface IDBFactory {
  /**
   * Compares two values as keys. Returns -1 if key1 precedes key2, 1 if key2 precedes key1, and 0 if the keys are equal.
   *
   * Throws a "DataError" DOMException if either input is not a valid key.
   */
  cmp(first: any, second: any): number;
  databases(): Promise<IDBDatabaseInfo[]>;
  /** Attempts to delete the named database. If the database already exists and there are open connections that don't close in response to a versionchange event, the request will be blocked until all they close. If the request is successful request's result will be null. */
  deleteDatabase(name: string): IDBOpenDBRequest;
  /** Attempts to open a connection to the named database with the current version, or 1 if it does not already exist. If the request is successful request's result will be the connection. */
  open(name: string, version?: number): IDBOpenDBRequest;
}

declare var IDBFactory: {
  prototype: IDBFactory;
  new (): IDBFactory;
};

/** IDBIndex interface of the IndexedDB API provides asynchronous access to an index in a database. An index is a kind of object store for looking up records in another object store, called the referenced object store. You use this interface to retrieve data. */
interface IDBIndex {
  readonly keyPath: string | string[];
  readonly multiEntry: boolean;
  /** Returns the name of the index. */
  name: string;
  /** Returns the IDBObjectStore the index belongs to. */
  readonly objectStore: IDBObjectStore;
  readonly unique: boolean;
  /**
   * Retrieves the number of records matching the given key or key range in query.
   *
   * If successful, request's result will be the count.
   */
  count(query?: IDBValidKey | IDBKeyRange): IDBRequest<number>;
  /**
   * Retrieves the value of the first record matching the given key or key range in query.
   *
   * If successful, request's result will be the value, or undefined if there was no matching record.
   */
  get(query: IDBValidKey | IDBKeyRange): IDBRequest<any>;
  /**
   * Retrieves the values of the records matching the given key or key range in query (up to count if given).
   *
   * If successful, request's result will be an Array of the values.
   */
  getAll(
    query?: IDBValidKey | IDBKeyRange | null,
    count?: number,
  ): IDBRequest<any[]>;
  /**
   * Retrieves the keys of records matching the given key or key range in query (up to count if given).
   *
   * If successful, request's result will be an Array of the keys.
   */
  getAllKeys(
    query?: IDBValidKey | IDBKeyRange | null,
    count?: number,
  ): IDBRequest<IDBValidKey[]>;
  /**
   * Retrieves the key of the first record matching the given key or key range in query.
   *
   * If successful, request's result will be the key, or undefined if there was no matching record.
   */
  getKey(
    query: IDBValidKey | IDBKeyRange,
  ): IDBRequest<IDBValidKey | undefined>;
  /**
   * Opens a cursor over the records matching query, ordered by direction. If query is null, all records in index are matched.
   *
   * If successful, request's result will be an IDBCursorWithValue, or null if there were no matching records.
   */
  openCursor(
    query?: IDBValidKey | IDBKeyRange | null,
    direction?: IDBCursorDirection,
  ): IDBRequest<IDBCursorWithValue | null>;
  /**
   * Opens a cursor with key only flag set over the records matching query, ordered by direction. If query is null, all records in index are matched.
   *
   * If successful, request's result will be an IDBCursor, or null if there were no matching records.
   */
  openKeyCursor(
    query?: IDBValidKey | IDBKeyRange | null,
    direction?: IDBCursorDirection,
  ): IDBRequest<IDBCursor | null>;
}

declare var IDBIndex: {
  prototype: IDBIndex;
  new (): IDBIndex;
};

/** A key range can be a single value or a range with upper and lower bounds or endpoints. If the key range has both upper and lower bounds, then it is bounded; if it has no bounds, it is unbounded. A bounded key range can either be open (the endpoints are excluded) or closed (the endpoints are included). To retrieve all keys within a certain range, you can use the following code constructs: */
interface IDBKeyRange {
  /** Returns lower bound, or undefined if none. */
  readonly lower: any;
  /** Returns true if the lower open flag is set, and false otherwise. */
  readonly lowerOpen: boolean;
  /** Returns upper bound, or undefined if none. */
  readonly upper: any;
  /** Returns true if the upper open flag is set, and false otherwise. */
  readonly upperOpen: boolean;
  /** Returns true if key is included in the range, and false otherwise. */
  includes(key: any): boolean;
}

declare var IDBKeyRange: {
  prototype: IDBKeyRange;
  new (): IDBKeyRange;
  /** Returns a new IDBKeyRange spanning from lower to upper. If lowerOpen is true, lower is not included in the range. If upperOpen is true, upper is not included in the range. */
  bound(
    lower: any,
    upper: any,
    lowerOpen?: boolean,
    upperOpen?: boolean,
  ): IDBKeyRange;
  /** Returns a new IDBKeyRange starting at key with no upper bound. If open is true, key is not included in the range. */
  lowerBound(lower: any, open?: boolean): IDBKeyRange;
  /** Returns a new IDBKeyRange spanning only key. */
  only(value: any): IDBKeyRange;
  /** Returns a new IDBKeyRange with no lower bound and ending at key. If open is true, key is not included in the range. */
  upperBound(upper: any, open?: boolean): IDBKeyRange;
};

/** This example shows a variety of different uses of object stores, from updating the data structure with IDBObjectStore.createIndex inside an onupgradeneeded function, to adding a new item to our object store with IDBObjectStore.add. For a full working example, see our To-do Notifications app (view example live.) */
interface IDBObjectStore {
  /** Returns true if the store has a key generator, and false otherwise. */
  readonly autoIncrement: boolean;
  /** Returns a list of the names of indexes in the store. */
  readonly indexNames: DOMStringList;
  /** Returns the key path of the store, or null if none. */
  readonly keyPath: string | string[];
  /** Returns the name of the store. */
  name: string;
  /** Returns the associated transaction. */
  readonly transaction: IDBTransaction;
  /**
   * Adds or updates a record in store with the given value and key.
   *
   * If the store uses in-line keys and key is specified a "DataError" DOMException will be thrown.
   *
   * If put() is used, any existing record with the key will be replaced. If add() is used, and if a record with the key already exists the request will fail, with request's error set to a "ConstraintError" DOMException.
   *
   * If successful, request's result will be the record's key.
   */
  add(value: any, key?: IDBValidKey): IDBRequest<IDBValidKey>;
  /**
   * Deletes all records in store.
   *
   * If successful, request's result will be undefined.
   */
  clear(): IDBRequest<undefined>;
  /**
   * Retrieves the number of records matching the given key or key range in query.
   *
   * If successful, request's result will be the count.
   */
  count(query?: IDBValidKey | IDBKeyRange): IDBRequest<number>;
  /**
   * Creates a new index in store with the given name, keyPath and options and returns a new IDBIndex. If the keyPath and options define constraints that cannot be satisfied with the data already in store the upgrade transaction will abort with a "ConstraintError" DOMException.
   *
   * Throws an "InvalidStateError" DOMException if not called within an upgrade transaction.
   */
  createIndex(
    name: string,
    keyPath: string | string[],
    options?: IDBIndexParameters,
  ): IDBIndex;
  /**
   * Deletes records in store with the given key or in the given key range in query.
   *
   * If successful, request's result will be undefined.
   */
  delete(query: IDBValidKey | IDBKeyRange): IDBRequest<undefined>;
  /**
   * Deletes the index in store with the given name.
   *
   * Throws an "InvalidStateError" DOMException if not called within an upgrade transaction.
   */
  deleteIndex(name: string): void;
  /**
   * Retrieves the value of the first record matching the given key or key range in query.
   *
   * If successful, request's result will be the value, or undefined if there was no matching record.
   */
  get(query: IDBValidKey | IDBKeyRange): IDBRequest<any>;
  /**
   * Retrieves the values of the records matching the given key or key range in query (up to count if given).
   *
   * If successful, request's result will be an Array of the values.
   */
  getAll(
    query?: IDBValidKey | IDBKeyRange | null,
    count?: number,
  ): IDBRequest<any[]>;
  /**
   * Retrieves the keys of records matching the given key or key range in query (up to count if given).
   *
   * If successful, request's result will be an Array of the keys.
   */
  getAllKeys(
    query?: IDBValidKey | IDBKeyRange | null,
    count?: number,
  ): IDBRequest<IDBValidKey[]>;
  /**
   * Retrieves the key of the first record matching the given key or key range in query.
   *
   * If successful, request's result will be the key, or undefined if there was no matching record.
   */
  getKey(
    query: IDBValidKey | IDBKeyRange,
  ): IDBRequest<IDBValidKey | undefined>;
  index(name: string): IDBIndex;
  /**
   * Opens a cursor over the records matching query, ordered by direction. If query is null, all records in store are matched.
   *
   * If successful, request's result will be an IDBCursorWithValue pointing at the first matching record, or null if there were no matching records.
   */
  openCursor(
    query?: IDBValidKey | IDBKeyRange | null,
    direction?: IDBCursorDirection,
  ): IDBRequest<IDBCursorWithValue | null>;
  /**
   * Opens a cursor with key only flag set over the records matching query, ordered by direction. If query is null, all records in store are matched.
   *
   * If successful, request's result will be an IDBCursor pointing at the first matching record, or null if there were no matching records.
   */
  openKeyCursor(
    query?: IDBValidKey | IDBKeyRange | null,
    direction?: IDBCursorDirection,
  ): IDBRequest<IDBCursor | null>;
  /**
   * Adds or updates a record in store with the given value and key.
   *
   * If the store uses in-line keys and key is specified a "DataError" DOMException will be thrown.
   *
   * If put() is used, any existing record with the key will be replaced. If add() is used, and if a record with the key already exists the request will fail, with request's error set to a "ConstraintError" DOMException.
   *
   * If successful, request's result will be the record's key.
   */
  put(value: any, key?: IDBValidKey): IDBRequest<IDBValidKey>;
}

declare var IDBObjectStore: {
  prototype: IDBObjectStore;
  new (): IDBObjectStore;
};

interface IDBOpenDBRequestEventMap extends IDBRequestEventMap {
  "blocked": Event;
  "upgradeneeded": IDBVersionChangeEvent;
}

/** Also inherits methods from its parents IDBRequest and EventTarget. */
interface IDBOpenDBRequest extends IDBRequest<IDBDatabase> {
  onblocked: ((this: IDBOpenDBRequest, ev: Event) => any) | null;
  onupgradeneeded:
    | ((this: IDBOpenDBRequest, ev: IDBVersionChangeEvent) => any)
    | null;
  addEventListener<K extends keyof IDBOpenDBRequestEventMap>(
    type: K,
    listener: (
      this: IDBOpenDBRequest,
      ev: IDBOpenDBRequestEventMap[K],
    ) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof IDBOpenDBRequestEventMap>(
    type: K,
    listener: (
      this: IDBOpenDBRequest,
      ev: IDBOpenDBRequestEventMap[K],
    ) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var IDBOpenDBRequest: {
  prototype: IDBOpenDBRequest;
  new (): IDBOpenDBRequest;
};

interface IDBRequestEventMap {
  "error": Event;
  "success": Event;
}

/** The request object does not initially contain any information about the result of the operation, but once information becomes available, an event is fired on the request, and the information becomes available through the properties of the IDBRequest instance. */
interface IDBRequest<T = any> extends EventTarget {
  /** When a request is completed, returns the error (a DOMException), or null if the request succeeded. Throws a "InvalidStateError" DOMException if the request is still pending. */
  readonly error: DOMException | null;
  onerror: ((this: IDBRequest<T>, ev: Event) => any) | null;
  onsuccess: ((this: IDBRequest<T>, ev: Event) => any) | null;
  /** Returns "pending" until a request is complete, then returns "done". */
  readonly readyState: IDBRequestReadyState;
  /** When a request is completed, returns the result, or undefined if the request failed. Throws a "InvalidStateError" DOMException if the request is still pending. */
  readonly result: T;
  /** Returns the IDBObjectStore, IDBIndex, or IDBCursor the request was made against, or null if is was an open request. */
  readonly source: IDBObjectStore | IDBIndex | IDBCursor;
  /** Returns the IDBTransaction the request was made within. If this as an open request, then it returns an upgrade transaction while it is running, or null otherwise. */
  readonly transaction: IDBTransaction | null;
  addEventListener<K extends keyof IDBRequestEventMap>(
    type: K,
    listener: (this: IDBRequest<T>, ev: IDBRequestEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof IDBRequestEventMap>(
    type: K,
    listener: (this: IDBRequest<T>, ev: IDBRequestEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var IDBRequest: {
  prototype: IDBRequest;
  new (): IDBRequest;
};

interface IDBTransactionEventMap {
  "abort": Event;
  "complete": Event;
  "error": Event;
}

interface IDBTransaction extends EventTarget {
  /** Returns the transaction's connection. */
  readonly db: IDBDatabase;
  /** If the transaction was aborted, returns the error (a DOMException) providing the reason. */
  readonly error: DOMException | null;
  /** Returns the mode the transaction was created with ("readonly" or "readwrite"), or "versionchange" for an upgrade transaction. */
  readonly mode: IDBTransactionMode;
  /** Returns a list of the names of object stores in the transaction's scope. For an upgrade transaction this is all object stores in the database. */
  readonly objectStoreNames: DOMStringList;
  onabort: ((this: IDBTransaction, ev: Event) => any) | null;
  oncomplete: ((this: IDBTransaction, ev: Event) => any) | null;
  onerror: ((this: IDBTransaction, ev: Event) => any) | null;
  /** Aborts the transaction. All pending requests will fail with a "AbortError" DOMException and all changes made to the database will be reverted. */
  abort(): void;
  commit(): void;
  /** Returns an IDBObjectStore in the transaction's scope. */
  objectStore(name: string): IDBObjectStore;
  addEventListener<K extends keyof IDBTransactionEventMap>(
    type: K,
    listener: (this: IDBTransaction, ev: IDBTransactionEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof IDBTransactionEventMap>(
    type: K,
    listener: (this: IDBTransaction, ev: IDBTransactionEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var IDBTransaction: {
  prototype: IDBTransaction;
  new (): IDBTransaction;
};

/** This IndexedDB API interface indicates that the version of the database has changed, as the result of an IDBOpenDBRequest.onupgradeneeded event handler function. */
interface IDBVersionChangeEvent extends Event {
  readonly newVersion: number | null;
  readonly oldVersion: number;
}

declare var IDBVersionChangeEvent: {
  prototype: IDBVersionChangeEvent;
  new (
    type: string,
    eventInitDict?: IDBVersionChangeEventInit,
  ): IDBVersionChangeEvent;
};

interface IDBVersionChangeEventInit extends EventInit {
  newVersion?: number | null;
  oldVersion?: number;
}

type IDBRequestReadyState = "done" | "pending";
type IDBValidKey = number | string | Date | BufferSource | IDBValidKey[];
type IDBCursorDirection = "next" | "nextunique" | "prev" | "prevunique";

type IDBTransactionMode = "readonly" | "readwrite" | "versionchange";
interface IDBIndexParameters {
  multiEntry?: boolean;
  unique?: boolean;
}

interface IDBDatabaseInfo {
  name?: string;
  version?: number;
}

interface IDBObjectStoreParameters {
  autoIncrement?: boolean;
  keyPath?: string | string[] | null;
}
