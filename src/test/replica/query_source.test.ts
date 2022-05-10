import { Crypto } from "../../crypto/crypto.ts";
import { ReplicaDriverMemory } from "../../replica/replica-driver-memory.ts";
import { CoreDoc, QuerySourceEvent } from "../../replica/replica-types.ts";
import { Replica } from "../../replica/replica.ts";
import { CallbackSink } from "../../streams/stream_utils.ts";
import { AuthorKeypair } from "../../util/doc-types.ts";
import { sleep } from "../../util/misc.ts";
import { assertEquals } from "../asserts.ts";

Deno.test("QuerySource", async () => {
  const SHARE_ADDR = "+test.a123";

  const keypair = await Crypto.generateAuthorKeypair("test") as AuthorKeypair;
  const keypairB = await Crypto.generateAuthorKeypair(
    "suzy",
  ) as AuthorKeypair;

  const replica = new Replica(
    { driver: new ReplicaDriverMemory(SHARE_ADDR) },
  );

  await replica.set(keypair, {
    content: "a",
    format: "es.4",
    path: "/wanted/1",
  });

  await replica.set(keypair, {
    content: "b",
    format: "es.4",
    path: "/wanted/2",
  });

  await replica.set(keypairB, {
    content: "c",
    format: "es.4",
    path: "/wanted/1",
  });

  await replica.set(keypair, {
    content: "🐸",
    format: "es.4",
    path: "/unwanted/1",
  });

  const existingStream = replica.getQueryStream({
    historyMode: "all",
    orderBy: "localIndex ASC",
    filter: {
      pathStartsWith: "/wanted",
    },
  }, "existing");

  const existingWantedContent = [];

  for await (const event of existingStream) {
    existingWantedContent.push(event.doc.content);
  }

  assertEquals(
    existingWantedContent,
    ["a", "b", "c"],
    "QueryStream returned existing content which matched filter",
  );

  const everythingStream = replica.getQueryStream({
    historyMode: "all",
    orderBy: "localIndex ASC",
    filter: {
      pathStartsWith: "/wanted",
    },
  }, "everything");

  const onlyNewStream = replica.getQueryStream({
    historyMode: "all",
    orderBy: "localIndex ASC",
    filter: {
      pathStartsWith: "/wanted",
    },
  }, "new");

  await replica.set(keypair, {
    content: "d",
    format: "es.4",
    path: "/wanted/3",
  });

  const everythingWantedContent: string[] = [];
  const newWantedContent: string[] = [];

  const everythingCallbackSink = new CallbackSink<QuerySourceEvent<CoreDoc>>();

  everythingCallbackSink.onWrite((event) => {
    everythingWantedContent.push(event.doc.content);
  });

  const newCallbackSink = new CallbackSink<QuerySourceEvent<CoreDoc>>();

  newCallbackSink.onWrite((event) => {
    newWantedContent.push(event.doc.content);
  });

  everythingStream.pipeTo(new WritableStream(everythingCallbackSink));
  onlyNewStream.pipeTo(new WritableStream(newCallbackSink));

  await sleep(10);

  assertEquals(
    everythingWantedContent,
    ["a", "b", "c", "d"],
  );

  assertEquals(
    newWantedContent,
    ["d"],
  );

  await replica.close(true);
});
