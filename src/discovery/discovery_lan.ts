import { advertise, browse, MulticastInterface } from "../../../dns-sd/mod.ts";
import { deferred } from "../../deps.ts";
import { ValidationError } from "../util/errors.ts";
import { PartnerTcp } from "../syncer/partner_tcp.ts";
import { IPeer } from "../peer/peer-types.ts";
import { Syncer } from "../syncer/syncer.ts";
import {
  DecryptLengthDelimitStream,
  DecryptStream,
} from "../syncer/message_crypto.ts";
import { SyncAppetite } from "../syncer/syncer_types.ts";

type DiscoveryLANOpts = {
  peer: IPeer;
  name: string;
  advertise?: boolean;
  appetite: SyncAppetite;
};

export class DiscoveryLAN {
  private abortController = new AbortController();
  private multicastInterface = new MulticastInterface();
  private listener = Deno.listen({ port: 3999 });

  //  IP address.
  private sessions = new Map<string, LANSession>();
  // A map of IP addresses to service names.
  private serviceNames = new Map<string, string>();

  constructor(opts: DiscoveryLANOpts) {
    // Need to set up a listener here that can create partners...

    if (opts.advertise) {
      advertise({
        multicastInterface: this.multicastInterface,
        service: {
          name: opts.name,
          port: 3999,
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
      for await (const conn of this.listener) {
        if (conn.remoteAddr.transport !== "tcp") {
          continue;
        }

        const key = `${conn.remoteAddr.hostname}:${conn.remoteAddr.port}`;
        const existingSession = this.sessions.get(key);

        if (existingSession) {
          existingSession.addConn(conn);
        } else {
          const session = new LANSession(
            false,
            opts.peer,
            opts.appetite,
            // Hopefully this works well enough.
            {
              hostname: conn.remoteAddr.hostname,
              port: conn.remoteAddr.port,
              name: this.serviceNames.get(key),
            },
          );
          this.sessions.set(key, session);
          session.addConn(conn);
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
        const key = `${service.host}:${service.port}`;

        this.serviceNames.set(key, service.name);

        if (!this.sessions.has(key)) {
          // TODO: Wait some random amount of time.

          const session = new LANSession(true, opts.peer, opts.appetite, {
            hostname: service.host,
            port: service.port,
            name: service.name,
          });
          const key = `${service.host}:${service.port}`;
          this.sessions.set(key, session);
        }
      }
    })();
  }

  stop() {
    this.abortController.abort();
  }
}

export class LANSession {
  initiator: boolean;
  description: string;
  private peer: IPeer;
  private appetite: SyncAppetite;
  syncer = deferred<Syncer<Deno.Conn, unknown>>();

  // ECDH
  private keypair = deferred<CryptoKeyPair>();
  private derivedSecret = deferred<CryptoKey>();

  private targetPort: number;

  constructor(
    initiator: boolean,
    peer: IPeer,
    appetite: SyncAppetite,
    target: { hostname: string; port: number; name?: string },
  ) {
    this.initiator = initiator;
    this.peer = peer;
    this.description = target.name || `${target.hostname}:${target.port}`;
    this.appetite = appetite;
    this.targetPort = target.port;

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

    if (initiator) {
      // Open keyexchange connection
      Deno.connect({
        hostname: target.hostname,
        port: target.port,
      }).then((conn) => {
        this.addKeyExchangeConn(conn);
      });

      // Open messaging connection
      Deno.connect({
        hostname: target.hostname,
        port: target.port,
      }).then((conn) => {
        this.addMessageConn(conn);
      });
    }
  }

  async addConn(conn: Deno.Conn) {
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

  async addKeyExchangeConn(conn: Deno.Conn) {
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

  async addMessageConn(conn: Deno.Conn) {
    if (this.syncer.state === "fulfilled") {
      return;
    }

    // If we're the initiator, send the identifying byte.
    if (this.initiator) {
      const idByte = new Uint8Array(1);
      const idView = new DataView(idByte.buffer);
      idView.setUint8(0, ConnKind.Messages);

      await conn.write(idByte);
    }

    // Create a new TCP partner here.
    const derivedKey = await this.derivedSecret;

    const partner = new PartnerTcp(
      conn,
      this.appetite,
      derivedKey,
      this.targetPort,
    );

    const syncer = this.peer.addSyncPartner(
      partner,
      this.description,
    );

    this.syncer.resolve(syncer);
  }

  async addAttachmentConn(conn: Deno.Conn) {
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

async function identifyConn(conn: Deno.Conn): Promise<ConnKind> {
  const firstByte = new Uint8Array(1);

  await conn.read(firstByte);

  const dataView = new DataView(firstByte.buffer);

  const kindId = dataView.getUint8(0);

  if (kindId > 2) {
    throw new ValidationError("Incoming connection was not of valid type");
  }

  return kindId;
}
