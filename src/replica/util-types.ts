//================================================================================
// BASIC UTILITY TYPES

export type Thunk = () => void;
export type Callback<T> = (data: T) => void;
export type AsyncCallback<T> = (data: T) => Promise<void>;
export type SyncOrAsyncCallback<T> = (data: T) => Promise<void> | void;

// The type of a class that implementes interface T.
// let arr: ClassThatImplements<IWhatever> = [Whatever1, Whatever2]
export type ClassThatImplements<T> = new (...args: any[]) => T;

export enum Cmp {
    // this sorts ascendingly
    LT = -1,
    EQ = 0,
    GT = 1,
}
