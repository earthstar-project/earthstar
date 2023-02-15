# Changelog

<<<<<<< ours
=======
## NEXT

- (Feature) Added `createInvitationURL` and `parseInvitationURL` utilities for
  creating and parsing Earthstar invitation URLs.
- (Fix) `parseShareAddress` now validates share addresses more strictly so as to
  ensure their suffix is a pubkey.

>>>>>>> theirs
## v10.0.2

- (Fix) `DocDriverSqliteFfi` has been updated to use
  `https://deno.land/x/sqlite3@0.7.3` which has compatibility with Deno 1.30.0.
  This driver uses unstable APIs and will not work with previous versions of
  Deno.
- (Chore) Upgraded [range-reconcile](https://github.com/earthstar-project/range-reconcile) to version 1.0.1.

## v10.0.1

This is a patch release focused on resolving errors encountered during syncing,
and making other issues encountered during syncing easier to diagnose.

- (Fix) - Peers will now only initiate a single transfer for many documents with
  the same attachment, fixing a case which could cause syncing to hang
  indefinitely.
- (Fix) - Peers will now attempt to download attachments for documents which
  they already possess prior to syncing but are missing attachments for.
- (Improvement) - Syncer will cancel itself if it does not receive anything from
  the other peer within a ten second window.
- (Improvement) - Syncer will cancel an attachment transfer if it doesn't
  receive anything from the other side within a ten second window.
- (Improvement) - Warn in the console when a replica could not ingest an
  attachment during sync.
- (Improvement) - Better error messages for web syncing failures (e.g. 404,
  wrong endpoint).

## v10.0.0

This is a major release which introduces attachments, share keypairs, efficient
sync, and much much more. It is our biggest release _ever_.

As such, this version breaks compatibility with previous versions of Earthstar.

Here are the headline features:

- **Attachments**. When a new document is written to a Replica you can attach
  arbitary binary data to it. This can be used for sharing large images, music,
  video, anything. There is no size limit.
- **Shares with granular read / write access**. Share addresses are now the
  public key of a share keypair. The public key grants discovery and read
  access, the secret key grants write access to the replica.
- **Efficient sync**. Syncing has been completely overhauled to use a new
  efficient reconclition mechanism powered by
  [range-reconcile](earthstar-project/range-reconcile) and
  push-pull-push-multicast trees.

The server APIs have also been moved into this repo.

In addition to new features, many APIs have been tweaked or changed entirely.
Please see the API documentation and the README to see what these new API
changes are like.

## Server

- Moved existing server APIs into the core module, available as `Server`.

## Peer

- Added `Peer.onReplicasChange`
- Added `Peer.onSyncersChange`

## Replica

- Significantly improved the performance of querying documents.
- Replicas now can create documents with attachments with `Replica.set`
- Added `Replica.ingestAttachment`
- Added `Replica.getAttachment`
- Added `Replica.addAttachments`
- Added `Replica.wipeDocAtPath`
- Added `Replica.getEventStream`
- Added `Replica.getQueryStream`
- Added `Replica.onEvent`
- Added `MultiformatReplica`, a Replica which is able to read, write, and sync
  documents of different formats.
- Added `FormatEs5`, which supports share keypairs and attachments
- Added `ReplicaDriverWeb`
- Added `ReplicaDriverFs`
- Added `RelpicaDriverMemory`
- Added `DocDriverSqliteFFI`, which uses an FFI implemetation of Sqlite.
  Requires the `--unstable` flag on Deno.
- Updated `syncReplicaAndFsDir` to use attachments for large files.
- `ReplicaCache` now has attachment methods

## Syncing

- Added `PartnerLocal`, for syncing with local peers.
- Added `PartnerWebServer`, for syncing with servers.
- Added `PartnerWebClient`, for syncing with web clients.

- **Removed** earthstar_streaming_rpc as a dependency.

## Queries

- **Removed** the `contentLength` options on `QueryFilter`.
- **Removed** `QueryFollower`. Use `Replica.getQueryStream` instead.

- `queryByTemplateAsync` and `queryByGlobAsync` have had the redundant `async`
  taken out of their name.

## Cryptography

- Added `Crypto.generateShareKeypair`
- Added `CryptoDriverSodium` which uses a WASM version of libsodium for very
  fast operations. This is now the default driver on Deno.
- Updated `CryptoDriverNoble` to use a new, faster, audited version.

## Other

- Added a new `SharedSettings` class for easily saving and retrieving an author
  keypair, shares and secrets, and favourite servers.
- Added parseAuthorOrShareAddress
- Added a new minified web bundle, available from
  https://cdn.earthstar-project.org/js/earthstar.web.v10.0.0.js
- Added ARCHITECTURE.md
- Added CONTRIBUTING.md
- Added CODE_OF_CONDUCT.md

## v9.3.3

- Fix: Removed the crayon dependency, fixing a broken dependency issue in 9.3.2

## v9.3.2

- Updated earthstar_streaming_rcp to v5.0.1

## v9.3.1

- Updated earthstar_streaming_rcp to v5.0.0

## v9.3.0

- Feature: Replica will now permanently delete all expired documents on
  instantiation, and delete expired docs every hour thereafter. Previously it
  would only stop returning expired docs in user queries.
- Feature: Added `Replica.queryAuthors` and `Replica.queryPaths`, which returns
  an array of (unique) authors of paths from the docs resulting from that query.

## 9.2.0

- Feature: Added `generateShareAddress` utility to generate valid, safe share
  addresses.
- Feature: Updated filesystem sync so that deleted (not just modified) files can
  be overwritten using the `overwriteFilesAtOwnedPaths` option.

## 9.1.0

- Feature: Added 'overwriteFilesAtOwnedPaths' option to SyncFsOptions. This will
  forcibly overwrite any files at paths owned by other identities with ones from
  the replica.

## 9.0.1

- Added a `pulled` property to syncer statuses.
- Fixed an issue where SyncCoordinators would pull twice as much as they needed
  to.

## 9.0.0

- Breaking: Syncing has been updated so that peers inform each other when they
  are caught up. v7 - v8 peers will not be able to sync with each other.
- Patch: Addressed an issue affecting synchronisation with HTTP peers.
- Feature: Peer.syncUntilCaughtUp. Syncs with targets until both sides of the
  synchronisation have nothing left to pull from each other.
- Patch: SyncCoordinator will now request 10 docs at a time instead of
  everything a peer has.
- Feature: Peer.syncStatuses. Subscribable map of Peer's sync operations'
  statuses.
- Feature: Syncer.syncStatuses. Subscribable map of syncer's connections' sync
  statuses.
- Feature: SyncCoordinator.syncStatuses. Subscribable map of coordinator's
  shares' sync statuses, with number of ingested docs and 'caught up' status of
  each syncing session.
- Patch: Common shares between peers are re-established whenever a Peer's set of
  replicas chages.
- Patch: Improved the heuristic `syncReplicaAndFsDir` uses to determine whether
  a file has changed or not, fixing issues where files at owned paths which had
  not been changed would cause the function to throw.

## 8.3.1

- Patch: Made `syncReplicaAndFsDir` ignore `.DS_Store` files.
- Patch: Improve how `syncReplicaAndFsDir` determines the latest version of a
  document, fixing an issue with 'zombie' files which would return after
  deletion.

## 8.3.0

- Feature: Added a new export, `syncReplicaAndFsDir`, which bidirectionally
  syncs the contents of a replica and filesystem directory.
- Patch: Replica drivers will now validate share addresses which have been
  passed to them.
- Patch: ReplicaDriverSqlite (Deno and Node) now initialise their maxLocalIndex
  correctly, fixing issues where new documents could not be created.
- Patch: ReplicaDriverSqlite (Deno) now no longer fails when using the `create`
  mode.
- Patch: SyncCoordinator now requests all document history from other peers.
