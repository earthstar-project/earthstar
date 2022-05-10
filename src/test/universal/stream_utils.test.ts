import { LockStream, MultiStream } from "../../streams/stream_utils.ts";
import { sleep } from "../../util/misc.ts";
import { assert, assertEquals } from "../asserts.ts";

function makeNumberStream(startFrom: number) {
  return new ReadableStream({
    start(controller) {
      for (let i = startFrom; i < startFrom + 10; i++) {
        controller.enqueue(i);
      }

      controller.close();
    },
  });
}

function makeCollectorStream<T>(arr: T[]): WritableStream<T> {
  return new WritableStream({
    write(chunk) {
      arr.push(chunk);
    },
  });
}

Deno.test("Multistream", async () => {
  const stream0 = makeNumberStream(0);
  const stream10 = makeNumberStream(10);
  const stream20 = makeNumberStream(20);

  const outgoingStreams = [stream0, stream10, stream20];

  const multiStream = new MultiStream();

  const collectors: number[][] = [[], [], []];

  for (const collector of collectors) {
    multiStream.getReadableStream().pipeTo(makeCollectorStream(collector));
  }

  for (const outgoing of outgoingStreams) {
    outgoing.pipeTo(multiStream.getWritableStream());
  }

  const [c1, c2, c3] = collectors;

  await sleep(10);

  // Check all the collectors are the right length.
  assertEquals(c1.length, 30);
  assertEquals(c2.length, 30);
  assertEquals(c3.length, 30);

  // Check they all got the right values.m
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
