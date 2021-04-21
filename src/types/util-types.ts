//================================================================================ 
// BASIC UTILITY TYPES

export type Thunk = () => void;
export type Callback<T> = (data: T) => void;
export type AsyncCallback<T> = (data: T) => Promise<void>;
export type SyncOrAsyncCallback<T> = (data: T) => Promise<void> | void;

export enum Cmp {
    // this sorts ascendingly
    LT = -1,
    EQ = 0,
    GT = 1,
}
