import { deferred } from "https://deno.land/std@0.150.0/async/deferred.ts";
import { IDBDatabase } from "https://deno.land/x/indexeddb@v1.1.0/lib/indexeddb.ts";
import {
  IDBKeyRange,
  indexedDB,
} from "https://deno.land/x/indexeddb@v1.1.0/ponyfill_memory.ts";

// setup

const req = indexedDB.open("test_db");

const dbPromise = deferred<IDBDatabase>();

req.onupgradeneeded = () => {
  req.result.createObjectStore("test_store");
  const store = req.result.createObjectStore("doc_store", {
    keyPath: "localIndex",
  });
  store.createIndex("pathAndTimestamp", ["path", "timestamp"], {
    //multiEntry: true,
  });

  store.createIndex("localIndex", "localIndex", {
    // multiEntry: true,
  });
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

const putReq2 = db.transaction(["doc_store"], "readwrite").objectStore(
  "doc_store",
).put({
  path: "/hey",
  timestamp: 400,
  localIndex: 3,
});

const putReq3 = db.transaction(["doc_store"], "readwrite").objectStore(
  "doc_store",
).put({
  path: "/hey",
  timestamp: 300,
  localIndex: 1,
});

const putReq4 = db.transaction(["doc_store"], "readwrite").objectStore(
  "doc_store",
).put({
  path: "/bo",
  timestamp: 200,
  localIndex: 2,
});

const putDeferred2 = deferred<void>();
const putDeferred3 = deferred<void>();
const putDeferred4 = deferred<void>();

putReq2.onsuccess = () => putDeferred2.resolve();
putReq3.onsuccess = () => putDeferred3.resolve();
putReq4.onsuccess = () => putDeferred4.resolve();

await putDeferred2;
await putDeferred3;
await putDeferred4;

const index = db.transaction(["doc_store"], "readwrite").objectStore(
  "doc_store",
).index("pathAndTimestamp");

const indexGetAll = index.getAll(
  IDBKeyRange.bound([" ", 0], ["/hey", Number.MAX_SAFE_INTEGER]),
);

indexGetAll.onsuccess = () => {
  console.log("hmmm");
  console.log(indexGetAll.result);
  console.log("...");
};

const indexGet = index.get(
  IDBKeyRange.bound(["/hey"], ["/hey", Number.MAX_SAFE_INTEGER]),
);

indexGet.onsuccess = () => {
  console.log("yo");
  console.log(indexGet.result);
  console.log("...");
};

const cursorGet0 = index.openCursor(
  IDBKeyRange.bound(["/hey"], ["/hey", Number.MAX_SAFE_INTEGER]),
  "prev",
);

cursorGet0.onsuccess = () => {
  console.log("ehh");
  console.log(cursorGet0.result?.value);
  console.log("...");
};

cursorGet0.onerror = () => {
  console.log("whaa");
};

const localIndex = db.transaction(["doc_store"], "readwrite").objectStore(
  "doc_store",
).index("localIndex");

const cursorGet = localIndex.openCursor(null, "prev");

cursorGet.onsuccess = () => {
  console.log(cursorGet.result?.value);
};
