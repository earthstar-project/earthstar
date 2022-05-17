import { assert } from "./asserts.ts";
import { Replica } from "../replica/replica.ts";
import { AuthorKeypair } from "../util/doc-types.ts";
import { deepEqual, randomId } from "../util/misc.ts";
import { isErr } from "../util/errors.ts";
import { FormatValidatorEs4 } from "../format-validators/format-validator-es4.ts";
import { ReplicaDriverMemory } from "../replica/replica-driver-memory.ts";
import { CoreDoc } from "../replica/replica-types.ts";

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
    driver: new ReplicaDriverMemory(addr),
  });
}

export function makeNReplicas(addr: string, number: number) {
  return Array.from({ length: number }, () => makeReplica(addr));
}

function stripLocalIndexFromDoc({ _localIndex, ...rest }: CoreDoc) {
  return { ...rest };
}

export function docsAreEquivalent(docsA: CoreDoc[], docsB: CoreDoc[]) {
  if (docsA.length !== docsB.length) {
    return false;
  }

  const sortByPathThenAuthor = (docA: CoreDoc, docB: CoreDoc) => {
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
  };

  const aStripped = docsA.map(stripLocalIndexFromDoc).sort(
    sortByPathThenAuthor,
  );
  const bStripped = docsB.map(stripLocalIndexFromDoc).sort(
    sortByPathThenAuthor,
  );

  return deepEqual(aStripped, bStripped);
}

export function writeRandomDocs(
  keypair: AuthorKeypair,
  storage: Replica,
  n: number,
) {
  const fstRand = randomId();

  const setPromises = Array.from({ length: n }, () => {
    const rand = randomId();

    return storage.set(keypair, {
      content: `${rand}`,
      path: `/${fstRand}/${rand}.txt`,
      format: "es.4",
    });
  });

  return Promise.all(setPromises);
}

export async function storagesAreSynced(storages: Replica[]): Promise<boolean> {
  const allDocsSets: CoreDoc[][] = [];

  // Create an array where each element is a collection of all the docs from a storage.
  for await (const storage of storages) {
    const allDocs = await storage.getAllDocs();
    allDocsSets.push(allDocs);
  }

  return allDocsSets.reduce((isSynced: boolean, docs: CoreDoc[], i: number) => {
    if (i === 0) {
      return isSynced;
    }

    // Get the set of docs from the previous element.
    const prevDocs = allDocsSets[i - 1];

    const strippedDocs = docs.map(stripLocalIndexFromDoc);
    const strippedPrevDocs = prevDocs.map(stripLocalIndexFromDoc);

    // See if they're equivalent with the current set.
    return docsAreEquivalent(strippedPrevDocs, strippedDocs);
  }, false as boolean);
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
      return deepEqual(doc, aDoc);
    }) !== undefined;
  }, true);

  return aHasAllB;
}
