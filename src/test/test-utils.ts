import { assert, equal } from "./asserts.ts";
import { Replica } from "../replica/replica.ts";
import { DocBase, DocWithAttachment } from "../util/doc-types.ts";
import { randomId } from "../util/misc.ts";
import { DocDriverMemory } from "../replica/doc_drivers/memory.ts";

import { DocEs5, DocInputEs5, FormatEs5 } from "../formats/format_es5.ts";
import { AttachmentDriverMemory } from "../replica/attachment_drivers/memory.ts";
import { isErr } from "../util/errors.ts";

import { bytesEquals, shallowEqualObjects } from "../../deps.ts";
import { AuthorKeypair, ShareKeypair } from "../crypto/crypto-types.ts";
import { Crypto } from "../crypto/crypto.ts";

// for testing unicode
export const snowmanString = "\u2603"; // ☃ \u2603  [0xe2, 0x98, 0x83] -- 3 bytes
export const snowmanBytes = Uint8Array.from([0xe2, 0x98, 0x83]);

export const throws = async (fn: () => Promise<any>, msg: string) => {
  try {
    await fn();
    assert(false, "failed to throw: " + msg);
  } catch (err) {
    assert(true, msg);
  }
};

export const doesNotThrow = async (
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

export function makeReplica(addr: string, shareSecret: string) {
  return new Replica({
    driver: {
      docDriver: new DocDriverMemory(addr),
      attachmentDriver: new AttachmentDriverMemory(),
    },
    shareSecret,
  });
}

export function makeNReplicas(addr: string, secret: string, number: number) {
  return Array.from({ length: number }, () => makeReplica(addr, secret));
}

function stripLocalIndexFromDoc(
  { _localIndex, ...rest }: DocBase<string>,
) {
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

  if (!equal(aStripped, bStripped)) {
    console.log(aStripped, bStripped);
  }

  return equal(aStripped, bStripped);
}

export async function docAttachmentsAreEquivalent(
  docsA: DocWithAttachment<DocEs5>[],
  docsB: DocWithAttachment<DocEs5>[],
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

  // Zip them and compare the attachments of each.

  const zipped = aSorted.map((doc, i) => [doc, bSorted[i]]);

  for (const [a, b] of zipped) {
    if (
      a.attachment && b.attachment && !isErr(a.attachment) &&
      !isErr(b.attachment)
    ) {
      const aBytes = await a.attachment.bytes();
      const bBytes = await b.attachment.bytes();

      if (bytesEquals(aBytes, bBytes) === false) {
        console.log("A");
        return false;
      }
    }

    if (a.attachment === undefined && b.attachment !== undefined) {
      return false;
    }

    if (b.attachment === undefined && a.attachment !== undefined) {
      return false;
    }

    if (isErr(a.attachment) && !isErr(b.attachment)) {
      return false;
    }

    if (isErr(b.attachment) && !isErr(a.attachment)) {
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

  const hasAttachment = Math.random() >= 0.8;

  const setPromises = Array.from({ length: n }, () => {
    const rand = randomId();

    if (hasAttachment) {
      const bytes = crypto.getRandomValues(
        new Uint8Array((Math.random() + 0.1) * 32 * 32 * 32),
      );

      return storage.set(keypair, {
        text: `${rand}`,
        path: `/${fstRand}/${rand}.txt`,
        attachment: bytes,
      });
    }

    return storage.set(keypair, {
      text: `${rand}`,
      path: `/${fstRand}/${rand}`,
    });
  });

  return Promise.all(setPromises);
}

export async function overlappingDocSets(
  authorKeypair: AuthorKeypair,
  shareKeypair: ShareKeypair,
  /** The amount of overlap between the two replicas, represented as a percentage. */
  overlapPercentage: number,
  totalSize: number,
  numberOfSets: number,
) {
  const docs: {
    doc: DocEs5;
    attachment?: Uint8Array | ReadableStream<Uint8Array> | undefined;
  }[] = [];

  const overlap = Math.round((overlapPercentage / 100) * totalSize);
  const docsToGenerate = (totalSize * numberOfSets) - overlap;

  for (let i = 0; i < docsToGenerate; i++) {
    const rand = randomId();

    const input: DocInputEs5 = {
      text: `${rand}`,
      path: `/${rand}`,
      format: "es.5",
    };

    const hasAttachment = Math.random() >= 0.8;

    if (hasAttachment) {
      const bytes = crypto.getRandomValues(
        new Uint8Array((Math.random() + 0.1) * 32 * 32 * 32),
      );

      input.path = `/${rand}.txt`;
      input.attachment = bytes;
    }

    const result = await FormatEs5.generateDocument({
      input,
      keypair: authorKeypair,
      share: shareKeypair.shareAddress,
      timestamp: Date.now() * 1000,
      config: { shareSecret: shareKeypair.secret },
    });

    if (!isErr(result)) {
      if (result.attachment) {
        const updatedDoc = await FormatEs5.updateAttachmentFields(
          authorKeypair,
          result.doc,
          (result.attachment as Uint8Array).byteLength,
          await Crypto.sha256base32(result.attachment as Uint8Array),
          { shareSecret: shareKeypair.secret },
        );

        if (!isErr(updatedDoc)) {
          result.doc = updatedDoc;
        }
      }

      docs.push(result);
    }
  }

  const overlappingDocs = docs.slice(0, overlap);

  const sets = [];

  for (let i = 0; i < numberOfSets; i++) {
    const start = i === 0 ? overlap : ((totalSize - overlap) * i);
    const end = i === 0 ? totalSize : (totalSize - overlap) * (i + 1);

    const uniqueDocs = docs.slice(start, end);

    const set = [...overlappingDocs, ...uniqueDocs];

    sets.push(set);
  }

  return sets;
}

export async function replicaDocsAreSynced(
  replicas: Replica[],
): Promise<boolean> {
  const allDocsSets: DocBase<string>[][] = [];

  // Create an array where each element is a collection of all the docs from a storage.
  for await (const replica of replicas) {
    const allDocs = await replica.getAllDocs();
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

export async function replicaAttachmentsAreSynced(
  storages: Replica[],
): Promise<boolean> {
  const allDocsSets: DocWithAttachment<DocEs5>[][] = [];

  // Create an array where each element is a collection of all the docs from a storage.
  for await (const storage of storages) {
    const allDocs = await storage.getAllDocs();

    const docsWithAttachments = await storage.addAttachments(allDocs);

    allDocsSets.push(docsWithAttachments);
  }

  for (let i = 0; i < allDocsSets.length; i++) {
    if (i === 0) {
      continue;
    }

    const docs = allDocsSets[i];
    // Get the set of docs from the previous element.
    const prevDocs = allDocsSets[i - 1];

    // See if they're equivalent with the current set.
    const allSynced = await docAttachmentsAreEquivalent(docs, prevDocs);

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
      return shallowEqualObjects(doc, aDoc);
    }) !== undefined;
  }, true);

  return aHasAllB;
}
