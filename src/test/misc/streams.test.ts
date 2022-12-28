import {
  ChannelMultiStream,
  ChannelTransformer,
  CloneStream,
  LockStream,
  MultiStream,
  OrCh,
} from "../../streams/stream_utils.ts";
import { sleep } from "../../util/misc.ts";
import {
  bytesToStream,
  getStreamSize,
  readStream,
} from "../../util/streams.ts";
import { assert, assertEquals } from "../asserts.ts";

function makeNumberStream(startFrom: number) {
  return new ReadableStream<number>({
    start(controller) {
      for (let i = startFrom; i < startFrom + 10; i++) {
        controller.enqueue(i);
      }

      controller.close();
    },
  });
}

type TestChannel = "fromZero" | "fromHundred" | "fromThousand";
type TestEvent = { channel: TestChannel; value: number };

function makeEventStream(key: TestChannel, startFrom: number) {
  return new ReadableStream<TestEvent>({
    start(controller) {
      for (let i = startFrom; i < startFrom + 10; i++) {
        controller.enqueue({
          channel: key,
          value: startFrom,
        });
      }

      controller.close();
    },
  });
}

function makeCollectorWritable<T>(arr: T[]): WritableStream<T> {
  return new WritableStream({
    write(chunk) {
      arr.push(chunk);
    },
  });
}

Deno.test("CloneStream", async () => {
  const stream = makeNumberStream(0);

  const cloneStream = new CloneStream();

  stream.pipeTo(cloneStream.writable);

  const readable1 = cloneStream.getReadableStream();
  const readable2 = cloneStream.getReadableStream();

  await sleep(10);

  const a = await readStream(readable1);
  const b = await readStream(readable2);

  const readable3 = cloneStream.getReadableStream();

  const c = await readStream(readable3);

  assertEquals(a, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assertEquals(b, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assertEquals(c, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

Deno.test("Multistream", async () => {
  const stream0 = makeNumberStream(0);
  const stream10 = makeNumberStream(10);
  const stream20 = makeNumberStream(20);

  const outgoingStreams = [stream0, stream10, stream20];

  const multiStream = new MultiStream();

  const collectors: number[][] = [[], [], []];

  for (const collector of collectors) {
    multiStream.getReadableStream().pipeTo(makeCollectorWritable(collector));
  }

  for (const outgoing of outgoingStreams) {
    outgoing.pipeTo(multiStream.getWritableStream());
  }

  const [c1, c2, c3] = collectors;

  await sleep(3);

  // Check all the collectors are the right length.
  assertEquals(c1.length, 30);
  assertEquals(c2.length, 30);
  assertEquals(c3.length, 30);

  // Check they all got the right values.
  for (let i = 0; i < 30; i++) {
    assert(c1.includes(i), `c1 includes ${i}`);
    assert(c2.includes(i), `c2 includes ${i}`);
    assert(c3.includes(i), `c3 includes ${i}`);
  }

  // TODO: Check that closing works.
});

Deno.test("LockStream", async () => {
  const arr: string[] = [];

  // Here's a function which creates a result depending on the previous state.
  const write = async (el: string) => {
    await sleep(Math.floor(Math.random() * (5 - 0 + 1) + 0));

    const lastEl = arr[arr.length - 1];
    const nextEl = [lastEl, el].join("");

    arr.push(nextEl);
  };

  const lock = new LockStream();

  lock.run(() => write("a"));
  lock.run(() => write("b"));
  lock.run(() => write("c"));

  await sleep(20);

  assertEquals(arr, ["a", "ab", "abc"], "Lock stream wrote sequentially.");
});

Deno.test("ChannelTransformer", async () => {
  type ChannelType = "a" | "b";
  type EventType = { channel: ChannelType; value: number };

  const channels: ChannelType[] = ["a", "b"];

  const eventStream = new ReadableStream<EventType>({
    start(controller) {
      for (let i = 0; i < 10; i++) {
        controller.enqueue({
          channel: channels[i % 2],
          value: i,
        });
      }

      controller.close();
    },
  });

  const collectorArr: EventType[] = [];

  const collectorStream = makeCollectorWritable(collectorArr);

  const channelTransform = new ChannelTransformer<
    ChannelType,
    "channel",
    EventType
  >("a", "channel");

  eventStream.pipeThrough(new TransformStream(channelTransform)).pipeTo(
    collectorStream,
  );

  await sleep(1);

  assertEquals(collectorArr.length, 5, "Channeled all A events");
  assert(
    collectorArr.every((event) => event.channel === "a"),
    "Channelled only A events",
  );
});

Deno.test("ChannelMultiStream", async () => {
  const stream0 = makeEventStream("fromZero", 0);
  const stream100 = makeEventStream("fromHundred", 100);
  const stream1000 = makeEventStream("fromThousand", 1000);

  const outgoingStreams: ReadableStream<TestEvent>[] = [
    stream0,
    stream100,
    stream1000,
  ];

  const multiChannelStream = new ChannelMultiStream<
    TestChannel,
    "channel",
    TestEvent
  >(
    "channel",
  );

  type Collector = { channel: OrCh<TestChannel>; collected: TestEvent[] };

  const collectors: Collector[] = [
    { channel: "fromZero", collected: [] },
    { channel: "fromHundred", collected: [] },
    { channel: "fromThousand", collected: [] },
    { channel: "*", collected: [] },
  ];

  for (const collector of collectors) {
    multiChannelStream.getReadableStream(collector.channel).pipeTo(
      makeCollectorWritable(collector.collected),
    );
  }

  for (const outgoing of outgoingStreams) {
    outgoing.pipeTo(multiChannelStream.getWritableStream());
  }

  const [c0, c100, c1000, cAll] = collectors;

  await sleep(3);

  // Check all the collectors are the right length.
  assertEquals(c0.collected.length, 10, "channel fromZero got 10 events");
  assertEquals(c100.collected.length, 10, "channel fromHundred got 10 events");
  assertEquals(
    c1000.collected.length,
    10,
    "channel fromThousand got 10 events",
  );
  assertEquals(cAll.collected.length, 30, 'channel "*" got 30 events');

  assert(c0.collected.every((event) => event.channel === "fromZero"));
  assert(c100.collected.every((event) => event.channel === "fromHundred"));
  assert(c1000.collected.every((event) => event.channel === "fromThousand"));

  // TODO: Check that closing works.
});

Deno.test("getStreamSize", async () => {
  const bytes = new Uint8Array(2048);

  const stream = bytesToStream(bytes);

  const size = await getStreamSize(stream);

  assertEquals(size, bytes.length, "stream size is correct");
});
