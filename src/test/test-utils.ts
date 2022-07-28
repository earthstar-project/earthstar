import { assert } from "./asserts.ts";
import { Replica } from "../replica/replica.ts";
import { AuthorKeypair, DocBase, DocWithBlob } from "../util/doc-types.ts";
import { randomId } from "../util/misc.ts";
import { DocDriverMemory } from "../replica/doc_drivers/memory.ts";
import { equal } from "../../deps.ts";
import { FormatEs4 } from "../formats/format_es4.ts";
import { DocEs5, FormatEs5 } from "../formats/format_es5.ts";
import { BlobDriverMemory } from "../replica/blob_drivers/memory.ts";
import { isErr } from "../util/errors.ts";

import { equals } from "https://deno.land/std@0.138.0/bytes/mod.ts";

// for testing unicode
export let snowmanString = "\u2603"; // ☃ \u2603  [0xe2, 0x98, 0x83] -- 3 bytes
export let snowmanBytes = Uint8Array.from([0xe2, 0x98, 0x83]);

export let throws = async (fn: () => Promise<any>, msg: string) => {
  try {
    await fn();
    assert(false, "failed to throw: " + msg);
  } catch (err) {
    assert(true, msg);
  }
};

export let doesNotThrow = async (
  fn: () => Promise<any>,
  msg: string,
) => {
  try {
    await fn();
    assert(true, msg);
  } catch (err) {
    assert(false, "threw but should not have: " + msg);
  }
};

export function makeReplica(addr: string) {
  return new Replica({
    driver: {
      docDriver: new DocDriverMemory(addr),
      blobDriver: new BlobDriverMemory(),
    },
  });
}

export function makeNReplicas(addr: string, number: number) {
  return Array.from({ length: number }, () => makeReplica(addr));
}

function stripLocalIndexFromDoc({ _localIndex, ...rest }: DocBase<string>) {
  return { ...rest };
}

function sortByPathThenAuthor(
  docA: DocBase<string>,
  docB: DocBase<string>,
) {
  const { path: pathA, author: authorA } = docA;
  const { path: pathB, author: authorB } = docB;

  if (pathA < pathB) {
    return -1;
  }

  if (pathA > pathB) {
    return 1;
  }

  if (authorA < authorB) {
    return -1;
  }

  if (authorA > authorB) {
    return 1;
  }

  // Shouldn't happen.
  return 0 as never;
}

export function docsAreEquivalent(
  docsA: DocBase<string>[],
  docsB: DocBase<string>[],
) {
  if (docsA.length !== docsB.length) {
    return false;
  }

  const aStripped = docsA.map(stripLocalIndexFromDoc).sort(
    sortByPathThenAuthor,
  );
  const bStripped = docsB.map(stripLocalIndexFromDoc).sort(
    sortByPathThenAuthor,
  );

  return equal(aStripped, bStripped);
}

export async function docBlobsAreEquivalent(
  docsA: DocWithBlob<DocEs5>[],
  docsB: DocWithBlob<DocEs5>[],
): Promise<boolean> {
  if (docsA.length !== docsB.length) {
    return false;
  }

  const aSorted = docsA.sort(
    sortByPathThenAuthor,
  );
  const bSorted = docsB.sort(
    sortByPathThenAuthor,
  );

  // Zip them and compare the blobs of each.

  const zipped = aSorted.map((doc, i) => [doc, bSorted[i]]);

  for (const [a, b] of zipped) {
    if (a.blob && b.blob && !isErr(a.blob) && !isErr(b.blob)) {
      const aBytes = await a.blob.bytes();
      const bBytes = await b.blob.bytes();

      if (equals(aBytes, bBytes) === false) {
        return false;
      }
    }

    if (a.blob === undefined && b.blob !== undefined) {
      return false;
    }

    if (b.blob === undefined && a.blob !== undefined) {
      return false;
    }

    if (isErr(a.blob) && !isErr(b.blob)) {
      return false;
    }

    if (isErr(b.blob) && !isErr(a.blob)) {
      return false;
    }
  }

  return true;
}

export function writeRandomDocs(
  keypair: AuthorKeypair,
  storage: Replica,
  n: number,
) {
  const fstRand = randomId();

  const encoder = new TextEncoder();

  const setPromises = Array.from({ length: n }, () => {
    const rand = randomId();

    const bytes = crypto.getRandomValues(
      new Uint8Array((Math.random() + 0.1) * 32 * 32 * 32),
    );

    return storage.set(keypair, {
      text: `${rand}`,
      path: `/${fstRand}/${rand}.txt`,
      blob: bytes,
    });
  });

  return Promise.all(setPromises);
}

/*
export function writeRandomDocsEs4(
  keypair: AuthorKeypair,
  storage: Replica,
  n: number,
) {
  const fstRand = randomId();

  const setPromises = Array.from({ length: n }, () => {
    const rand = randomId();

    return storage.set(keypair, {
      content: `${rand}`,
      path: `/${fstRand}/${rand}`,
    }, FormatEs4);
  });

  return Promise.all(setPromises);
}
*/

export async function storagesAreSynced(storages: Replica[]): Promise<boolean> {
  const allDocsSets: DocBase<string>[][] = [];

  // Create an array where each element is a collection of all the docs from a storage.
  for await (const storage of storages) {
    const allDocs = await storage.getAllDocs();
    allDocsSets.push(allDocs);
  }

  const allDocsSynced = allDocsSets.reduce(
    (isSynced: boolean, docs: DocBase<string>[], i: number) => {
      if (i === 0) {
        return isSynced;
      }

      // Get the set of docs from the previous element.
      const prevDocs = allDocsSets[i - 1];

      // See if they're equivalent with the current set.
      return docsAreEquivalent(docs, prevDocs);
    },
    false as boolean,
  );

  return allDocsSynced;
}

export async function storagesBlobsAreSynced(
  storages: Replica[],
): Promise<boolean> {
  const allDocsSets: DocWithBlob<DocEs5>[][] = [];

  // Create an array where each element is a collection of all the docs from a storage.
  for await (const storage of storages) {
    const allDocs = await storage.getAllDocs();

    const docsWithBlobs = await storage.attachBlobs(allDocs);

    allDocsSets.push(docsWithBlobs);
  }

  for (let i = 0; i < allDocsSets.length; i++) {
    if (i === 0) {
      continue;
    }

    const docs = allDocsSets[i];
    // Get the set of docs from the previous element.
    const prevDocs = allDocsSets[i - 1];

    // See if they're equivalent with the current set.
    const allSynced = docsAreEquivalent(docs, prevDocs) &&
      await docBlobsAreEquivalent(docs, prevDocs);

    if (allSynced === false) {
      return false;
    }
  }

  return true;
}

export async function storageHasAllStoragesDocs(
  storageA: Replica,
  storageB: Replica,
): Promise<boolean> {
  const allADocs = await storageA.getAllDocs();
  const allBDocs = await storageB.getAllDocs();

  const strippedADocs = allADocs.map(stripLocalIndexFromDoc);
  const strippedBDocs = allBDocs.map(stripLocalIndexFromDoc);

  const aHasAllB = strippedBDocs.reduce((hasAll, doc) => {
    if (hasAll === false) {
      return hasAll;
    }

    return strippedADocs.find((aDoc) => {
      return equal(doc, aDoc);
    }) !== undefined;
  }, true);

  return aHasAllB;
}
