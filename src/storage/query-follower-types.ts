import {
    IStorageAsync
} from './storage-types';

export interface IQueryFollower {
    storage: IStorageAsync;

    hatch(): Promise<void>;
    isClosed(): boolean;
    close(): Promise<void>;
}
