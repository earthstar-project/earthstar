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

export * from "./src/entries/universal.ts";
export * from "./src/entries/deno.ts";
