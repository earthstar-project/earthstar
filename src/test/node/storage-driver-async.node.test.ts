import { WorkspaceAddress } from '../../util/doc-types';

import { runStorageDriverTests } from '../shared-test-code/storage-driver.shared';

import { storageDriversAsync_nodeAndUniversal } from './platform.node';

for (let storageDriver of storageDriversAsync_nodeAndUniversal) {
    let driverName = (storageDriver as any).name;
    let makeDriver = (ws: WorkspaceAddress) => new storageDriver(ws);
    runStorageDriverTests(driverName, makeDriver);
}
