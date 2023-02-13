/**
 * [Earthstar](https://earthstar-project.org) is a small and resilient distributed storage protocol designed with a strong focus on simplicity and versatility, with the social realities of peer-to-peer computing kept in mind.
 *
 * This is a reference implementation written in Typescript. You can use it to add Earthstar functionality to applications running on servers, browsers, the command line, or anywhere else JavaScript can be run.
 *
 * ### Example usage
 *
 * ```ts
 * import { Replica, ReplicaDriverMemory, Crypto, Peer } from "earthstar";
 *
 * const shareKeypair = await Crypto.generateShareKeypair("gardening");
 *
 * const replica = new Replica({
 * 	 driver: ReplicaDriverMemory(shareKeypair.shareAddress),
 * 	 shareSecret: shareKeypair.secret,
 * });
 *
 * const authorKeypair = await Crypto.generateAuthorKeypair("suzy");
 *
 * await replica.set(authorKeypair, {
 * 	 path: "/my-note",
 * 	 text: "Saw seven magpies today",
 * });
 *
 * const allDocs = await replica.getAllDocs();
 *
 * const peer = new Peer();
 *
 * peer.addReplica(replica);
 *
 * peer.sync("https://my.server")
 * ```
 *
 * This module also exposes server APIs for for building always-online peers. The below example reads some on-disk JSON to initiate some share replicas, and stores their data using the filesystem.
 *
 * ```ts
 * import {
 * ExtensionKnownShares,
 * ExtensionSyncWeb,
 * Server,
 * } from "https://deno.land/x/earthstar/mod.ts";
 *
 * const server = new Server([
 * new ExtensionKnownShares({
 * 	 knownSharesPath: "./known_shares.json",
 * 	 onCreateReplica: (shareAddress) => {
 * 		 return new Earthstar.Replica({
 * 			 driver: new ReplicaDriverFs(shareAddress, "./share_data"),
 * 		 });
 * 	 },
 * }),
 * new ExtensionSyncWebsocket(),
 * ]);
 *
 * @module
 */

export * from "../core-validators/addresses.ts";
export * from "../core-validators/characters.ts";
export * from "../core-validators/checkers.ts";

export * from "../crypto/base32.ts";
export * from "../crypto/crypto-driver-noble.ts";
export * from "../crypto/crypto-types.ts";
export * from "../crypto/crypto.ts";
export * from "../crypto/global-crypto-driver.ts";
export * from "../crypto/keypair.ts";

export * from "../formats/format_es4.ts";
export * from "../formats/format_es5.ts";
export * from "../formats/util.ts";
export * from "../formats/format_types.ts";

export * from "../syncer/syncer.ts";
export * from "../syncer/partner_local.ts";
export * from "../syncer/partner_web_client.ts";
export * from "../syncer/syncer_types.ts";

export * from "../peer/peer-types.ts";
export * from "../peer/peer.ts";

export * from "../query/query-types.ts";
export * from "../query/query.ts";
export * from "../query/query-helpers.ts";

export * from "../replica/compare.ts";
export * from "../replica/replica.ts";
export * from "../replica/replica_cache.ts";
export * from "../replica/replica-types.ts";
export * from "../replica/multiformat_replica.ts";
export * from "../replica/util-types.ts";
export * from "../replica/doc_drivers/memory.ts";
export * from "../replica/attachment_drivers/memory.ts";
export * from "../replica/driver_memory.ts";

export * from "../util/bytes.ts";
export * from "../util/doc-types.ts";
export * from "../util/errors.ts";
export * from "../util/log.ts";
export * from "../util/misc.ts";
export * from "../util/shared_settings.ts";
