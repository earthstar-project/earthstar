import { WorkspaceAddress } from "../../util/doc-types.ts";
import { IStorageAsync } from "../../storage/storage-types.ts";

import { CryptoDriverTweetnacl } from "../../crypto/crypto-driver-tweetnacl.ts";
import { FormatValidatorEs4 } from "../../format-validators/format-validator-es4.ts";
import { StorageAsync } from "../../storage/storage-async.ts";

import { storageDriversAsync_browserAndUniversal } from "./platform.browser.ts";

import { runPeerClientServerTests } from "../shared-test-code/peer-client-server.shared.ts";
import { runPeerTests } from "../shared-test-code/peer.shared.ts";
import { setGlobalCryptoDriver } from "../../crypto/global-crypto-driver.ts";

//================================================================================

for (let storageDriver of storageDriversAsync_browserAndUniversal) {
  // just hardcode this crypto driver since it works on all platforms
  let cryptoDriver = CryptoDriverTweetnacl;
  setGlobalCryptoDriver(cryptoDriver);

  let storageDriverName = (storageDriver as any).name;
  let cryptoDriverName = (cryptoDriver as any).name;
  let description = `${storageDriverName} + ${cryptoDriverName}`;

  let makeStorage = (ws: WorkspaceAddress): IStorageAsync => {
    let stDriver = new storageDriver(ws);
    let storage = new StorageAsync(ws, FormatValidatorEs4, stDriver);
    return storage;
  };

  runPeerTests(description, makeStorage);
  runPeerClientServerTests(description, makeStorage);
}
