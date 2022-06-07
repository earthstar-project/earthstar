import { Crypto } from "../../crypto/crypto.ts";
import { DocEs5, FormatEs5 } from "../../formats/format_es5.ts";
import { BlobDriverMemory } from "../../replica/blob_drivers/memory.ts";
import { DocDriverMemory } from "../../replica/doc_drivers/memory.ts";
import { QuerySourceEvent } from "../../replica/replica-types.ts";
import { Replica } from "../../replica/replica.ts";
import { CallbackSink } from "../../streams/stream_utils.ts";
import { AuthorKeypair } from "../../util/doc-types.ts";
import { sleep } from "../../util/misc.ts";
import { readStream } from "../../util/streams.ts";
import { assertEquals } from "../asserts.ts";

Deno.test("QuerySource", async () => {
  const SHARE_ADDR = "+test.a123";

  const keypair = await Crypto.generateAuthorKeypair("test") as AuthorKeypair;
  const keypairB = await Crypto.generateAuthorKeypair(
    "suzy",
  ) as AuthorKeypair;

  const replica = new Replica(
    {
      driver: {
        docDriver: new DocDriverMemory(SHARE_ADDR),
        blobDriver: new BlobDriverMemory(),
      },
    },
  );

  await replica.set(keypair, {
    text: "a",
    path: "/wanted/1",
  });

  await replica.set(keypair, {
    text: "b",
    path: "/wanted/2",
  });

  await replica.set(keypairB, {
    text: "c",
    path: "/wanted/1",
  });

  await replica.set(keypair, {
    text: "🐸",
    path: "/unwanted/1",
  });

  const existingStream = replica.getQueryStream(
    {
      historyMode: "all",
      orderBy: "localIndex ASC",
      filter: {
        pathStartsWith: "/wanted",
      },
    },
    [FormatEs5],
    "existing",
  );

  const results = await readStream(existingStream);
  const existingWantedContent = results.map((event) => {
    if (event.kind === "processed_all_existing") {
      return "STOP";
    }

    return event.doc.text;
  });

  assertEquals(
    existingWantedContent,
    ["a", "b", "c", "STOP"],
    "QueryStream returned existing content which matched filter",
  );

  const everythingStream = replica.getQueryStream(
    {
      historyMode: "all",
      orderBy: "localIndex ASC",
      filter: {
        pathStartsWith: "/wanted",
      },
    },
    [FormatEs5],
    "everything",
  );

  const onlyNewStream = replica.getQueryStream(
    {
      historyMode: "all",
      orderBy: "localIndex ASC",
      filter: {
        pathStartsWith: "/wanted",
      },
    },
    [FormatEs5],
    "new",
  );

  await replica.set(keypair, {
    text: "d",
    path: "/wanted/3",
  });

  const everythingWantedContent: string[] = [];
  const newWantedContent: string[] = [];

  const everythingCallbackSink = new CallbackSink<QuerySourceEvent<DocEs5>>();

  everythingCallbackSink.onWrite((event) => {
    if (event.kind === "processed_all_existing") {
      return;
    }
    everythingWantedContent.push(event.doc.text);
  });

  const newCallbackSink = new CallbackSink<QuerySourceEvent<DocEs5>>();

  newCallbackSink.onWrite((event) => {
    if (event.kind === "processed_all_existing") {
      return;
    }
    newWantedContent.push(event.doc.text);
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
