import { blake3wasm } from "../blake3/blake3.wasm.ts";
import type { Blake3Driver } from "../blake3/types.ts";
import { Ed25519noble } from "../cinn25519/ed25519/ed25519.noble.ts";
import type { Ed25519Driver } from "../cinn25519/types.ts";
import type { RuntimeDriver } from "../peer/types.ts";

/** A {@linkcode RuntimeDriver} with primitives which work on any runtime. */
export class RuntimeDriverUniversal implements RuntimeDriver {
  ed25519: Ed25519Driver<Uint8Array> = new Ed25519noble();
  blake3: Blake3Driver = blake3wasm;
}
