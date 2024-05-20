import { blake3std } from "../blake3/blake3.std.ts";
import { Blake3Driver } from "../blake3/types.ts";
import { Ed25519webcrypto } from "../cinn25519/ed25519/ed25519.webcrypto.ts";
import { Ed25519Driver } from "../cinn25519/types.ts";
import { RuntimeDriver } from "../peer/types.ts";

export class RuntimeDriverDeno implements RuntimeDriver {
  ed25519: Ed25519Driver<Uint8Array> = new Ed25519webcrypto();
  blake3: Blake3Driver = blake3std;
}
