import { FingerprintTree, LiftingMonoid, xxhash64 } from "../../deps.ts";
import { DocThumbnail } from "./syncer_types.ts";

/** Derive an order from two document thumbnails. */
function compareThumbnails(a: DocThumbnail, b: DocThumbnail) {
  const [timestampA, hashA] = a.split(" ");
  const [timestampB, hashB] = b.split(" ");

  const timestampAInt = parseInt(timestampA);
  const timestampBInt = parseInt(timestampB);

  if (timestampAInt > timestampBInt) {
    return 1;
  } else if (timestampAInt < timestampBInt) {
    return -1;
  }

  if (hashA > hashB) {
    return 1;
  } else if (hashA < hashB) {
    return -1;
  }

  return 0;
}

/** A lifting monoid which hashes a document thumbnail, and combines them using addition. */
const docThumbnailMonoid: LiftingMonoid<string, bigint> = {
  lift: (v: DocThumbnail) => {
    return xxhash64(v);
  },
  combine: (a: bigint, b: bigint) => {
    return a + b;
  },
  neutral: BigInt(0),
};

/** A FingerprintTree preconfigured for the insertion of DocThumbnails. */
export class DocThumbnailTree extends FingerprintTree<string, bigint> {
  constructor() {
    super(docThumbnailMonoid, compareThumbnails);
  }
}
