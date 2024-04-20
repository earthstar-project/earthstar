export function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i <= bytes.length; i += 8) {
        controller.enqueue(bytes.slice(i, i + 8));
      }

      controller.close();
    },
  });
}

export async function streamToBytes(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  let bytes = new Uint8Array();

  await stream.pipeTo(
    new WritableStream({
      write(chunk) {
        const nextBytes = new Uint8Array(bytes.length + chunk.length);
        nextBytes.set(bytes);
        nextBytes.set(chunk, bytes.length);
        bytes = nextBytes;
      },
    }),
  );

  return bytes;
}

export async function getStreamSize(stream: ReadableStream<Uint8Array>) {
  let size = 0;

  const sink = new WritableStream<Uint8Array>({
    write(chunk) {
      size += chunk.byteLength;
    },
  });

  await stream.pipeTo(sink);

  return size;
}

export async function readStream<ChunkType>(
  stream: ReadableStream<ChunkType>,
): Promise<ChunkType[]> {
  const arr: ChunkType[] = [];

  const writable = new WritableStream<ChunkType>({
    write(entry) {
      arr.push(entry);
    },
  });

  await stream.pipeTo(writable);

  return arr;
}
