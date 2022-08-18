// @denmo-types="../doc_drivers/indexeddb_types.deno.d.ts"
import {
  type IDBDatabase,
  indexedDB,
} from "https://deno.land/x/indexeddb@v1.1.0/ponyfill_memory.ts";

import { ShareAddress } from "../../util/doc-types.ts";
import { IReplicaAttachmentDriver } from "../replica-types.ts";

import { Logger } from "../../util/log.ts";
import { deferred } from "https://deno.land/std@0.150.0/async/deferred.ts";
import { EarthstarError, ValidationError } from "../../util/errors.ts";
import { Crypto } from "../../crypto/crypto.ts";
import { randomId } from "../../util/misc.ts";
import { streamToBytes } from "../../util/streams.ts";
const logger = new Logger("replica driver indexeddb", "gold");

const ATTACHMENT_STAGING_STORE = "attachment_staging_index";
const ATTACHMENT_INDEX_STORE = "attachments_index";
const ATTACHMENT_BYTES_STORE = "attachments_bytes";

export class AttachmentDriverIndexedDB implements IReplicaAttachmentDriver {
  private db = deferred<typeof IDBDatabase>();
  private share: ShareAddress;

  constructor(share: ShareAddress) {
    this.share = share;

    // dnt-shim-ignore
    if (!(window as any).indexedDB) {
      throw new EarthstarError("IndexedDB is not supported by this runtime.");
    }

    const request = (/*(window as any).*/ indexedDB).open(
      `earthstar:share_attachments:${this.share}`,
      1,
    );

    request.onerror = () => {
      logger.error(`Could not open IndexedDB for ${this.share}'s attachments.`);
      logger.error(request.error);
      throw new EarthstarError(
        `Could not open IndexedDB for ${this.share}'s attachments.`,
      );
    };

    request.onupgradeneeded = function () {
      const db = request.result;

      // we're going to store everything in one row.
      db.createObjectStore(ATTACHMENT_BYTES_STORE);
      db.createObjectStore(ATTACHMENT_INDEX_STORE, { keyPath: "id" });
      db.createObjectStore(ATTACHMENT_STAGING_STORE, { keyPath: "id" });
    };

    request.onsuccess = () => {
      this.db.resolve(request.result);
    };
  }

  async stage(
    formatName: string,
    attachment: Uint8Array | ReadableStream<Uint8Array>,
  ): Promise<
    {
      hash: string;
      size: number;
      commit: () => Promise<void>;
      reject: () => Promise<void>;
    } | ValidationError
  > {
    // How this works:
    // We write the data to a single IndexedDB object store which contains both staged / committed attachments.
    // When staging, we write a row to a store of staged attachments with the attachment's key.
    // If the attachment is reject, both the staging record and the attachment bytes are deleted.
    // If the attachment is committed, this record is moved from the store of staging records to the store of committed records.
    // The motivation is that we only write data once, as we have to load it all into memory first.

    const db = await this.db;

    const bytes = attachment instanceof Uint8Array
      ? attachment
      : await streamToBytes(attachment);

    const hash = await Crypto.sha256base32(bytes);

    const indexKey = `${formatName}___${hash}`;
    const blobKey = `${formatName}___${hash}___${randomId()}`;

    const transaction = db.transaction([
      ATTACHMENT_BYTES_STORE,
      ATTACHMENT_STAGING_STORE,
    ], "readwrite");

    const dataPut = transaction.objectStore(ATTACHMENT_BYTES_STORE).put(
      attachment,
      blobKey,
    );
    const stagingPut = transaction.objectStore(ATTACHMENT_STAGING_STORE).put({
      id: indexKey,
      blobKey,
    });

    const putDeferred = deferred();
    const stagingDeferred = deferred();

    dataPut.onsuccess = () => putDeferred.resolve();
    stagingPut.onsuccess = () => putDeferred.resolve();

    await putDeferred;
    await stagingDeferred;

    return {
      hash,
      size: bytes.byteLength,
      reject: async () => {
        const deleteTransaction = db.transaction([
          ATTACHMENT_BYTES_STORE,
          ATTACHMENT_STAGING_STORE,
        ]);

        const dataDelete = deleteTransaction.objectStore(
          ATTACHMENT_BYTES_STORE,
        ).delete(blobKey);
        const stagingDelete = deleteTransaction.objectStore(
          ATTACHMENT_STAGING_STORE,
        ).delete(indexKey);

        const deleteDeferred = deferred();
        const stagingDeferred = deferred();

        dataDelete.onsuccess = () => deleteDeferred.resolve();
        stagingDelete.onsuccess = () => stagingDeferred.resolve();

        await Promise.all([deleteDeferred, stagingDeferred]);
      },
      commit: async () => {
        // delete staging index
        // write proper index

        const transaction = db.transaction([
          ATTACHMENT_INDEX_STORE,
          ATTACHMENT_STAGING_STORE,
        ]);

        const deleteStaging = transaction.objectStore(
          ATTACHMENT_STAGING_STORE,
        ).delete(indexKey);

        const putRealIndex = transaction.objectStore(ATTACHMENT_INDEX_STORE)
          .put({ id: indexKey, blobKey });

        const deleteDeferred = deferred();
        const realIndexDeferred = deferred();

        deleteStaging.onsuccess = () => deleteDeferred.resolve();
        putRealIndex.onsuccess = () => realIndexDeferred.resolve();

        await Promise.all([deleteDeferred, realIndexDeferred]);
      },
    };
  }
}
