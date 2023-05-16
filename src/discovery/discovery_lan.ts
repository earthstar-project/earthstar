import {
  advertise,
  browse,
  MulticastInterface,
} from "https://deno.land/x/dns_sd@2.0.0/mod.ts";
import { AsyncQueue, deferred } from "../../deps.ts";
import { ValidationError } from "../util/errors.ts";
import { PartnerTcp } from "../syncer/partner_tcp.ts";
import { Syncer } from "../syncer/syncer.ts";
import {
  DecryptLengthDelimitStream,
  DecryptStream,
} from "../syncer/message_crypto.ts";
import { ISyncPartner, SyncAppetite } from "../syncer/syncer_types.ts";

import { DiscoveryService, DiscoveryServiceEvent } from "./types.ts";
import { sleep } from "../util/misc.ts";
import { TcpProvider } from "../tcp/tcp_provider.ts";
import { ITcpConn } from "../tcp/types.ts";

type DiscoveryLANOpts = {
  /** The name we wish to use to identify ourselves to other peers on the network. */
  name: string;
  /** Whether to advertise our presence on the network or not. Defaults to true. */
  advertise?: boolean;
  /** The port to listen for incoming connections on. Defaults to 17171. */
  port?: number;
};

const ES_PORT = 17171;

/** A discovery service for finding peers on the local network, to be used with `Peer.discover`.
 */
export class DiscoveryLAN implements DiscoveryService {
  private abortController = new AbortController();
  private multicastInterface = new MulticastInterface();

  private tcpProvider = new TcpProvider();

  //  IP address.
  private sessions = new Map<string, LANSession>();
  // A map of IP addresses to service names.
  private serviceNames = new Map<string, string>();

  private eventQueue = new AsyncQueue<DiscoveryServiceEvent>();

  constructor(opts: DiscoveryLANOpts) {
    // Need to set up a listener here that can create partners...
    const listener = this.tcpProvider.listen({ port: opts.port || ES_PORT });

    const shouldAdvertise = opts.advertise === undefined
      ? true
      : opts.advertise;

    if (shouldAdvertise) {
      advertise({
        multicastInterface: this.multicastInterface,
        service: {
          name: opts.name,
          port: opts.port || ES_PORT,
          protocol: "tcp",
          txt: {
            version: new TextEncoder().encode("10"),
          },
          type: "earthstar",
        },
        signal: this.abortController.signal,
      });
    }

    (async () => {
      for await (const conn of listener) {
        const key = `${conn.remoteAddr.hostname}`;
        const existingSession = this.sessions.get(key);

        if (existingSession) {
          existingSession.addConn(conn);
        } else {
          this.eventQueue.push({
            kind: "PEER_INITIATED_SYNC",
            description: this.serviceNames.get(key) || key,
            begin: async (peer) => {
              const session = new LANSession(
                {
                  onComplete: () => {
                    this.sessions.delete(key);
                    this.serviceNames.delete(key);
                  },
                  target: {
                    hostname: conn.remoteAddr.hostname,
                    name: this.serviceNames.get(key),
                  },
                  ourPort: opts.port || ES_PORT,
                },
              );
              this.sessions.set(key, session);
              session.addConn(conn);

              const partner = await session.partner;

              const syncer = peer.addSyncPartner(
                partner,
                this.serviceNames.get(key) || key,
              );

              session.syncer.resolve(syncer);

              return syncer;
            },
          });
        }
      }
    })();

    (async () => {
      for await (
        const service of browse({
          multicastInterface: this.multicastInterface,
          signal: this.abortController.signal,
          service: {
            protocol: "tcp",
            type: "earthstar",
          },
        })
      ) {
        const key = `${service.host}`;

        this.serviceNames.set(key, service.name);

        if (service.isActive === false) {
          this.eventQueue.push({
            kind: "PEER_EXITED",
            description: service.name,
          });

          continue;
        }

        this.eventQueue.push({
          kind: "PEER_DISCOVERED",
          description: service.name,
          begin: async (peer, appetite) => {
            if (this.sessions.has(key)) {
              throw new Error(
                "A syncer for this peer has already been started",
              );
            }

            await sleep(Math.random() * (120 - 20) + 20);

            const session = new LANSession(
              {
                initiator: { appetite, port: service.port },
                onComplete: () => {
                  this.sessions.delete(key);
                  this.serviceNames.delete(key);
                },
                target: {
                  hostname: service.host,
                  name: service.name,
                },
                ourPort: opts.port || ES_PORT,
              },
            );

            this.sessions.set(key, session);

            const partner = await session.partner;

            const syncer = peer.addSyncPartner(
              partner,
              this.serviceNames.get(key) || key,
            );

            session.syncer.resolve(syncer);

            return syncer;
          },
        });
      }
    })();
  }

  get events() {
    return this.eventQueue;
  }

  stop() {
    this.abortController.abort();

    this.eventQueue.push({
      kind: "SERVICE_STOPPED",
    });

    this.eventQueue.close();
  }
}

type LANSessionOpts = {
  initiator?: { appetite: SyncAppetite; port: number };
  target: { hostname: string; name?: string };
  ourPort: number;
  onComplete: () => void;
};

export class LANSession {
  initiator: { appetite: SyncAppetite } | undefined;
  description: string;

  private tcpProvider = new TcpProvider();

  // ECDH
  private keypair = deferred<CryptoKeyPair>();
  private derivedSecret = deferred<CryptoKey>();

  //
  private onComplete: () => void;
  private targetPort = deferred<number>();
  private ourPort: number;

  partner = deferred<ISyncPartner<ITcpConn>>();
  syncer = deferred<Syncer<ITcpConn, unknown>>();

  constructor(
    opts: LANSessionOpts,
  ) {
    this.initiator = opts.initiator;
    this.ourPort = opts.ourPort;

    this.description = opts.target.name || `${opts.target.hostname}`;
    this.onComplete = opts.onComplete;

    crypto.subtle.generateKey(
      {
        name: "ECDH",
        namedCurve: "P-256",
      },
      true,
      ["deriveKey", "deriveBits"],
    ).then((keypair) => {
      this.keypair.resolve(keypair);
    });

    if (opts.initiator) {
      this.targetPort.resolve(opts.initiator?.port);

      // Open keyexchange connection
      this.tcpProvider.connect({
        hostname: opts.target.hostname,
        port: opts.initiator.port,
      }).then((conn) => {
        this.addKeyExchangeConn(conn);
      });

      // Open messaging connection
      this.tcpProvider.connect({
        hostname: opts.target.hostname,
        port: opts.initiator.port,
      }).then((conn) => {
        this.addMessageConn(conn);
      });
    }

    this.syncer.then((syncer) => {
      syncer.isDone().then(() => {
        this.onComplete();
      }).catch(() => {
        this.onComplete();
      });
    });
  }

  async addConn(conn: ITcpConn) {
    const connKind = await identifyConn(conn);

    if (this.initiator && connKind !== ConnKind.Attachment) {
      // Only the initiator can start initiate messaging and key exchange.
      conn.close();

      return;
    }

    switch (connKind) {
      case ConnKind.Messages: {
        this.addMessageConn(conn);
        break;
      }
      case ConnKind.Attachment: {
        this.addAttachmentConn(conn);
        break;
      }
      case ConnKind.KeyExchange: {
        this.addKeyExchangeConn(conn);
      }
    }
  }

  async addKeyExchangeConn(conn: ITcpConn) {
    const ourKeypair = await this.keypair;

    if (this.initiator) {
      const idByte = new Uint8Array(1);
      const idView = new DataView(idByte.buffer);
      idView.setUint8(0, ConnKind.KeyExchange);

      await conn.write(idByte);
    }

    // Send our key to them.
    const publicKeyExported = await crypto.subtle.exportKey(
      "raw",
      ourKeypair.publicKey,
    );

    const keyExchangeMessageBytes = new Uint8Array(publicKeyExported);

    await conn.write(keyExchangeMessageBytes);

    const pubkeyBytes = new Uint8Array(65);

    const bytesRead = await conn.read(pubkeyBytes);

    conn.close();

    if (bytesRead === null) {
      throw new ValidationError("Was not able to read bytes of public key");
    }

    const otherPublicKey = await crypto.subtle.importKey(
      "raw",
      pubkeyBytes,
      {
        name: "ECDH",
        namedCurve: "P-256",
      },
      true,
      [],
    );

    // set that to our other public key.
    const derivedKey = await crypto.subtle.deriveKey(
      { name: "ECDH", public: otherPublicKey },
      ourKeypair.privateKey,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );

    this.derivedSecret.resolve(derivedKey);
  }

  async addMessageConn(conn: ITcpConn) {
    if (this.syncer.state === "fulfilled") {
      return;
    }

    let appetite = this.initiator?.appetite;

    // If we're the initiator, send the identifying byte.
    if (this.initiator) {
      const idByte = new Uint8Array(1);
      const idView = new DataView(idByte.buffer);
      idView.setUint8(0, ConnKind.Messages);

      await conn.write(idByte);

      // and don't forget the appetite byte
      const appetiteByte = new Uint8Array(1);
      const appetiteView = new DataView(appetiteByte.buffer);
      appetiteView.setUint8(0, this.initiator.appetite === "once" ? 0 : 1);

      await conn.write(appetiteByte);

      // And don't forget the port byte.
      const portBytes = new Uint8Array(2);
      const portView = new DataView(portBytes.buffer);
      portView.setUint16(0, this.ourPort);

      await conn.write(portBytes);
    }

    if (!appetite) {
      // Read the conn for the appetite byte...
      const appetiteByte = new Uint8Array(1);

      await conn.read(appetiteByte);

      const appetiteView = new DataView(appetiteByte.buffer);

      appetite = appetiteView.getUint8(0) === 0 ? "once" : "continuous";
    }

    if (!this.initiator) {
      const portBytes = new Uint8Array(2);

      await conn.read(portBytes);

      const portView = new DataView(portBytes.buffer);

      this.targetPort.resolve(portView.getUint16(0));
    }

    // Create a new TCP partner here.
    const derivedKey = await this.derivedSecret;

    const partner = new PartnerTcp(
      conn,
      appetite,
      derivedKey,
      await this.targetPort,
    );

    this.partner.resolve(partner);
  }

  async addAttachmentConn(conn: ITcpConn) {
    const derivedSecret = await this.derivedSecret;

    const transferDetails = deferred<{
      author: string;
      shareAddress: string;
      formatName: string;
      path: string;
    }>();

    conn.readable
      .pipeThrough(new DecryptLengthDelimitStream(derivedSecret))
      .pipeThrough(new DecryptStream(derivedSecret))
      .pipeTo(
        new WritableStream({
          write(chunk) {
            // We are only expecting one chunk.
            if (transferDetails.state !== "pending") {
              return;
            }

            const authorBytes = chunk.subarray(0, 59);

            const decoder = new TextDecoder();

            const shareLengthBytes = chunk.subarray(59, 60);
            const shareLenView = new DataView(
              shareLengthBytes.buffer,
              shareLengthBytes.byteOffset,
            );
            const shareLength = shareLenView.getUint8(0);

            const shareAddressBytes = chunk.subarray(60, 60 + shareLength);

            const formatLengthBytes = chunk.subarray(60 + shareLength, 1);
            const formatLenView = new DataView(
              formatLengthBytes.buffer,
              formatLengthBytes.byteOffset,
            );
            const formatLength = formatLenView.getUint8(0);

            const formatBytes = chunk.subarray(
              60 + shareLength + 1,
              60 + shareLength + 1 + formatLength,
            );

            const pathBytes = chunk.subarray(
              60 + shareLength + 1 + formatLength,
            );

            const author = decoder.decode(authorBytes);
            const shareAddress = decoder.decode(shareAddressBytes);
            const formatName = decoder.decode(formatBytes);
            const path = decoder.decode(pathBytes);

            transferDetails.resolve({
              author,
              shareAddress,
              formatName,
              path,
            });
          },
        }),
      ).catch(() => {
        // At some point the other side will close the connection and this will throw.
      });

    const { author, path, formatName, shareAddress } = await transferDetails;

    const syncer = await this.syncer;

    await syncer.handleTransferRequest({
      kind: "download",
      author,
      path,
      formatName,
      shareAddress,
      source: conn,
    });
  }
}

enum ConnKind {
  Messages,
  Attachment,
  KeyExchange,
}

async function identifyConn(conn: ITcpConn): Promise<ConnKind> {
  const firstByte = new Uint8Array(1);

  await conn.read(firstByte);

  const dataView = new DataView(firstByte.buffer);

  const kindId = dataView.getUint8(0);

  if (kindId > 2) {
    throw new ValidationError("Incoming connection was not of valid type");
  }

  return kindId;
}
