import { docMatchesFilter } from "../query/query.ts";
import { Query } from "../query/query-types.ts";
import {
  CoreDoc,
  IReplica,
  QuerySourceEvent,
  QuerySourceMode,
  QuerySourceOpts,
  ReplicaEvent,
} from "./replica-types.ts";

/** Use a replica and a query to create an UnderlyingSource for a ReadableStream, where each chunk from the stream is a `QuerySourceEvent`.
 */
export class QuerySource
  implements UnderlyingSource<QuerySourceEvent<CoreDoc>> {
  private replica: IReplica;
  private query: Query;
  private mode: QuerySourceMode = "everything";
  private eventStream: ReadableStream<ReplicaEvent<CoreDoc>> | undefined;

  constructor({ replica, query, mode }: QuerySourceOpts) {
    this.replica = replica;
    this.query = query;

    if (mode) {
      this.mode = mode;
    }
  }

  async start(
    controller: ReadableStreamDefaultController<QuerySourceEvent<CoreDoc>>,
  ) {
    if (this.mode === "existing" || this.mode === "everything") {
      const docs = await this.replica.queryDocs(this.query);

      for (const doc of docs) {
        controller.enqueue({ kind: "existing", doc });
      }
    }

    controller.enqueue({ kind: "processed_all_existing" });

    if (this.mode === "existing") {
      controller.close();
      return;
    }

    this.eventStream = this.replica.getEventStream();

    for await (const event of this.eventStream) {
      if (event.kind === "expire" || event.kind === "success") {
        if (this.query.filter) {
          if (docMatchesFilter(event.doc, this.query.filter)) {
            controller.enqueue(event);
            continue;
          }
        }

        controller.enqueue(event);
        continue;
      }
    }
  }
}
