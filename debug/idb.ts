import { deferred } from "https://deno.land/std@0.150.0/async/deferred.ts";
import { IDBDatabase } from "https://deno.land/x/indexeddb@v1.1.0/lib/indexeddb.ts";
import {
  indexedDB,
} from "https://deno.land/x/indexeddb@v1.1.0/ponyfill_memory.ts";

// setup

const req = indexedDB.open("test_db");

const dbPromise = deferred<IDBDatabase>();

req.onupgradeneeded = () => {
  req.result.createObjectStore("test_store");
};

req.onsuccess = () => {
  dbPromise.resolve(req.result);
};

const db = await dbPromise;

// set

const bytes = new TextEncoder().encode("Hello there");

const putReq = db.transaction(["test_store"], "readwrite").objectStore(
  "test_store",
).put(
  bytes,
  "test_key",
);

const putPromise = deferred<void>();

putReq.onsuccess = () => {
  putPromise.resolve();
};

await putPromise;

// get

const getReq = db.transaction(["test_store"], "readwrite").objectStore(
  "test_store",
).get("test_key");

const getPromise = deferred<Uint8Array>();

getReq.onsuccess = () => {
  getPromise.resolve(getReq.result);
};

const res = await getPromise;

const blob = new Blob([res]);

const url = URL.createObjectURL(blob);

console.log({ blob, url });
