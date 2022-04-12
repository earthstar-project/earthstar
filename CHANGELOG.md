# next

- Fix: SyncCoordinator will now request 10 docs at a time instead of everything
  a peer has.
- Feature: Peer.syncStatuses. Subscribable map of Peer's sync operations'
  statuses.
- Feature: Syncer.syncStatuses. Subscribable map of syncer's connections' sync
  statuses.
- Feature: SyncCoordinator.syncStatuses. Subscribable map of coordinator's
  shares' sync statuses, with number of ingested docs and 'caught up' status of
  each syncing session.
- Patch: Common shares between peers are re-established whenever a Peer's set of
  replicas chages.
