# next

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

# 8.3.1

- Patch: Made `syncReplicaAndFsDir` ignore `.DS_Store` files.
- Patch: Improve how `syncReplicaAndFsDir` determines the latest version of a
  document, fixing an issue with 'zombie' files which would return after
  deletion.

# 8.3.0

- Feature: Added a new export, `syncReplicaAndFsDir`, which bidirectionally
  syncs the contents of a replica and filesystem directory.
- Patch: Replica drivers will now validate share addresses which have been
  passed to them.
- Patch: ReplicaDriverSqlite (Deno and Node) now initialise their maxLocalIndex
  correctly, fixing issues where new documents could not be created.
- Patch: ReplicaDriverSqlite (Deno) now no longer fails when using the `create`
  mode.
- Patch: SyncCoordinator now requests all document history from other peers.