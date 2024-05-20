import * as Meadowcap from "@earthstar/meadowcap";
import { IdentityPublicKey } from "../identifiers/identity.ts";
import { SharePublicKey } from "../identifiers/share.ts";
import { EarthstarError } from "../util/errors.ts";
import { ReadCapPack, WriteCapPack } from "./types.ts";
import { concat } from "@std/bytes";
import { makeMeadowcapParams } from "../schemes/schemes.ts";
import { RuntimeDriver } from "../peer/types.ts";

export function isReadCapPack(
  capPack: ReadCapPack | WriteCapPack,
): capPack is ReadCapPack {
  return "readCap" in capPack;
}

export function isCommunalReadCapability(
  cap:
    | Meadowcap.CommunalCapability<
      SharePublicKey,
      IdentityPublicKey,
      Uint8Array
    >
      & { accessMode: "read" }
    | Meadowcap.CommunalCapability<
      SharePublicKey,
      IdentityPublicKey,
      Uint8Array
    >
      & { accessMode: "write" },
): cap is Meadowcap.CommunalReadCapability<
  SharePublicKey,
  IdentityPublicKey,
  Uint8Array
> {
  return cap.accessMode === "read";
}

export function isOwnedReadCapability(
  cap:
    | Meadowcap.OwnedCapability<
      SharePublicKey,
      IdentityPublicKey,
      Uint8Array,
      Uint8Array
    >
      & { accessMode: "read" }
    | Meadowcap.OwnedCapability<
      SharePublicKey,
      IdentityPublicKey,
      Uint8Array,
      Uint8Array
    >
      & { accessMode: "write" },
): cap is Meadowcap.OwnedReadCapability<
  SharePublicKey,
  IdentityPublicKey,
  Uint8Array,
  Uint8Array
> {
  return cap.accessMode === "read";
}

export function encodeCapPack(
  capPack: ReadCapPack | WriteCapPack,
  runtime: RuntimeDriver,
): Uint8Array {
  const meadowcap = new Meadowcap.Meadowcap(
    makeMeadowcapParams(runtime.ed25519, runtime.blake3),
  );

  if (!isReadCapPack(capPack)) {
    return concat([new Uint8Array([2]), meadowcap.encodeCap(capPack.writeCap)]);
  }

  if (capPack.subspaceCap === undefined) {
    return concat([new Uint8Array([0]), meadowcap.encodeCap(capPack.readCap)]);
  }

  return concat(
    [
      new Uint8Array([1]),
      meadowcap.encodeCap(capPack.readCap),
      meadowcap.encodeSubspaceCap(capPack.subspaceCap),
    ],
  );
}

export function decodeCapPack(
  encoded: Uint8Array,
  runtime: RuntimeDriver,
): ReadCapPack | WriteCapPack {
  const meadowcap = new Meadowcap.Meadowcap(
    makeMeadowcapParams(runtime.ed25519, runtime.blake3),
  );

  const [firstByte] = encoded;

  switch (firstByte) {
    case 0: {
      const cap = meadowcap.decodeCap(encoded.subarray(1));

      if (cap.accessMode !== "read") {
        throw new EarthstarError("Read cap encoded in WriteCapPack!");
      }

      return {
        readCap: cap as ReadCapPack["readCap"],
      };
    }
    case 1: {
      const cap = meadowcap.decodeCap(encoded.subarray(1));

      if (cap.accessMode !== "read") {
        throw new EarthstarError("Read cap encoded in WriteCapPack!");
      }

      const encodedAgain = meadowcap.encodeCap(cap);

      const subspaceCap = meadowcap.decodeSubspaceCap(
        encoded.subarray(1 + encodedAgain.byteLength),
      );

      return {
        readCap: cap as ReadCapPack["readCap"],
        subspaceCap,
      };
    }
    case 2: {
      const cap = meadowcap.decodeCap(encoded.subarray(1));

      if (cap.accessMode !== "write") {
        throw new EarthstarError("Read cap encoded in WriteCapPack!");
      }

      return {
        writeCap: cap as WriteCapPack["writeCap"],
      };
    }
    default:
      throw new EarthstarError("Could not decode cap pack!");
  }
}
