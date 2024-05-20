import { assert, assertEquals } from "@std/assert";
import { notErr } from "../util/errors.ts";
import {
  decodeCinn25519PublickKey,
  encodeCinn25519PublicKey,
  generateCinn25519Keypair,
} from "./cinn25519.ts";

type PubKeyEncodeVector = {
  shortname: string;
  minLength: number;
  maxLength: number;
};

const encodeVectors: PubKeyEncodeVector[] = [{
  shortname: "suzyq",
  minLength: 3,
  maxLength: 5,
}, {
  shortname: "suzy",
  minLength: 3,
  maxLength: 5,
}, {
  shortname: "suz",
  minLength: 3,
  maxLength: 5,
}];

Deno.test("encode / decode Cinn25519 public key", async () => {
  for (const { shortname, minLength, maxLength } of encodeVectors) {
    const keypair = await generateCinn25519Keypair(shortname, {
      minLength,
      maxLength,
    });

    assert(notErr(keypair));

    const encoded = encodeCinn25519PublicKey(keypair.publicKey, 5);
    const decoded = decodeCinn25519PublickKey(encoded, 5);

    assertEquals(decoded, keypair.publicKey);
  }
});
