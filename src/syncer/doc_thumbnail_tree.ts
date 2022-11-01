import { FingerprintTree, LiftingMonoid, xxHash32 } from "../../deps.ts";
import { DocBase } from "../util/doc-types.ts";
import { DocThumbnail } from "./syncer_types.ts";

/** Convert a document to a document thumbnail. */
function docToThumbnail(doc: DocBase<string>): DocThumbnail {
  return `${doc.timestamp} ${doc.path} ${doc.author}`;
}

/** Derive an order from two document thumbnails. */
function compareThumbnails(a: DocThumbnail, b: DocThumbnail) {
  const [timestampA, pathA, authorA] = a.split(" ");
  const [timestampB, pathB, authorB] = b.split(" ");

  const timestampAInt = parseInt(timestampA);
  const timestampBInt = parseInt(timestampB);

  if (timestampAInt > timestampBInt) {
    return 1;
  } else if (timestampAInt < timestampBInt) {
    return -1;
  }

  if (pathA > pathB) {
    return 1;
  } else if (pathA < pathB) {
    return -1;
  }

  if (authorA > authorB) {
    return 1;
  } else if (authorA < authorB) {
    return -1;
  }

  return 0;
}

/** A lifting monoid which hashes a document thumbnail, and combines them using a bitwise XOR. */
const docThumbnailMonoid: LiftingMonoid<string, Uint8Array> = {
  lift: (v: string) => {
    const hash = xxHash32(v).toString(16);
    return new TextEncoder().encode(hash);
  },
  combine: (a: Uint8Array, b: Uint8Array) => {
    const xored = [];

    for (let i = 0; i < a.length; i++) {
      xored.push(a[i] ^ b[i]);
    }

    return new Uint8Array(xored);
  },
  neutral: new Uint8Array(8),
};

/** A FingerprintTree preconfigured for the insertion of DocThumbnails. */
export class DocThumbnailTree extends FingerprintTree<string, Uint8Array> {
  constructor() {
    super(docThumbnailMonoid, compareThumbnails);
  }

  insertDoc(value: DocBase<string>): boolean {
    return super.insert(docToThumbnail(value));
  }

  removeDoc(value: DocBase<string>): boolean {
    return super.remove(docToThumbnail(value));
  }
}
