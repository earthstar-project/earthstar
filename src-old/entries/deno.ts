/**
 * Earthstar APIs which run in the Deno runtime.
 * @module
 */

export { ReplicaDriverFs } from "../replica/driver_fs.ts";
export { DocDriverLocalStorage } from "../replica/doc_drivers/localstorage.ts";
export { DocDriverSqlite } from "../replica/doc_drivers/sqlite.deno.ts";

// Uncomment when FFI APIs are stable
// export { DocDriverSqliteFfi } from "../replica/doc_drivers/sqlite_ffi.ts";
export { AttachmentDriverFilesystem } from "../replica/attachment_drivers/filesystem.ts";
export { CryptoDriverSodium } from "../crypto/crypto-driver-sodium.ts";
export { PartnerWebServer } from "../syncer/partner_web_server.ts";
export { syncReplicaAndFsDir } from "../sync-fs/sync-fs.ts";

// Servers
export * from "../server/server_core.ts";
export * from "../server/server.ts";
export * from "../server/extensions/extension.ts";
export * from "../server/extensions/known_shares.ts";
export * from "../server/extensions/server_settings.ts";
export * from "../server/extensions/sync_web.ts";
export * from "../server/extensions/serve_content.ts";

// LAN Discovery, uncomment when UDP APIs are stable.
// export * from "../discovery/discovery_lan.ts";
