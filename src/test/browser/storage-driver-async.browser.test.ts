import { WorkspaceAddress } from '../../util/doc-types';

import { runStorageDriverTests } from '../shared-test-code/storage-driver-async.shared';

import { storageDriversAsync_browserAndUniversal } from './platform.browser';

for (let storageDriver of storageDriversAsync_browserAndUniversal) {
    let driverName = (storageDriver as any).name;
    let makeDriver = (ws: WorkspaceAddress) => new storageDriver(ws);
    runStorageDriverTests(driverName, makeDriver);
}
