import { IPeer } from "../peer/peer-types.ts";
import { Syncer } from "../syncer/syncer.ts";
import { ISyncPartner, SyncAppetite } from "../syncer/syncer_types.ts";

export interface ITcpConn {
  read(bytes: Uint8Array): Promise<number | null>;
  write(bytes: Uint8Array): Promise<number | null>;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close(): void;
  remoteAddr: {
    hostname: string;
    port: number;
  };
}

export interface ITcpListener extends AsyncIterable<ITcpConn> {
  close(): void;
}

export interface ITcpProvider {
  listen(opts: { port: number }): ITcpListener;
  connect(opts: { port: number; hostname: string }): Promise<ITcpConn>;
}

// some new fun types

// Peer has discover method which takes adapter
// AsyncIterable<DiscoveryEvent>

export interface DiscoveryService<IncomingConnType> {
  events: AsyncIterable<DiscoveryServiceEvent<IncomingConnType>>;
  stop(): void;
}

export type DiscoveryServiceEvent<IncomingConnType> =
  | {
    kind: "PEER_DISCOVERED";
    description: string;
    begin: (
      peer: IPeer,
      appetite: SyncAppetite,
    ) => Promise<Syncer<unknown, unknown>>;
  }
  | {
    kind: "PEER_INITIATED_SYNC";
    description: string;
    begin: (
      peer: IPeer,
    ) => Promise<Syncer<unknown, unknown>>;
  }
  | {
    kind: "PEER_EXITED";
    description: string;
  }
  | {
    kind: "SERVICE_STOPPED";
  };

export type DiscoveryEvent =
  | {
    kind: "PEER_DISCOVERED";
    description: string;
    sync: (
      opts?: { syncContinuously: boolean },
    ) => Promise<Syncer<unknown, unknown>>;
  }
  | {
    kind: "PEER_INITIATED_SYNC";
    description: string;
    syncer: Syncer<unknown, unknown>;
  }
  | {
    kind: "PEER_EXITED";
    description: string;
  };
