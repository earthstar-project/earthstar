export {
  shallowEqualArrays,
  shallowEqualObjects,
} from "https://deno.land/x/shallow_equal@v0.1.3/mod.ts";
export { default as cloneDeep } from "https://deno.land/x/denodash@v0.1.3/src/lang/cloneDeep.ts";
export { default as fast_json_stable_stringify } from "https://esm.sh/fast-json-stable-stringify@2.1.0";
export * as rfc4648 from "https://esm.sh/rfc4648@1.5.0";
export * as sha256_uint8array from "https://esm.sh/sha256-uint8array@0.10.3";
export * as ed from "https://raw.githubusercontent.com/sgwilym/noble-ed25519/153f9e7e9952ad22885f5abb3f6abf777bef4a4c/mod.ts";
export { hash as xxhash64, XXH64 } from "./src/util/xxhash64.js";
export { FingerprintTree, RangeMessenger } from "../range-reconcile/mod.ts";
export type {
  LiftingMonoid,
  RangeMessengerConfig,
} from "../range-reconcile/mod.ts";
export { AsyncQueue } from "https://deno.land/x/for_awaitable_queue@1.0.0/mod.ts";

// Deno std lib

export {
  type Deferred,
  deferred,
} from "https://deno.land/std@0.154.0/async/deferred.ts";
export { equals as bytesEquals } from "https://deno.land/std@0.154.0/bytes/equals.ts";

// fs
// path
