import { Syncer } from "../syncer/syncer.ts";
import { ISyncPartner } from "../syncer/syncer_types.ts";

export interface DiscoveryService<I> {
  discovered(): AsyncIterable<[string, ISyncPartner<I>]>;
  addSyncer<F>(syncer: Syncer<I, F>): void;
  stop(): void;
}
