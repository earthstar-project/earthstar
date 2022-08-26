import { deferred } from "https://deno.land/std@0.138.0/async/deferred.ts";

export class CombineStream<T> {
  private closed = false;

  private transform: TransformStream<T, T> = new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);
    },
  });

  private writer = this.transform.writable.getWriter();

  readable = this.transform.readable;

  private writables: WritableStream<T>[] = [];

  private checkClosed() {
    if (this.closed) {
      throw "Closed";
    }
  }

  getWritableStream() {
    this.checkClosed();

    const writer = this.writer;

    const writable = new WritableStream<T>({
      async write(chunk) {
        await writer.ready;
        await writer.write(chunk);
      },
    });

    this.writables.push(writable);

    return writable;
  }

  async close() {
    this.checkClosed();

    for (const writableStream of this.writables) {
      await writableStream.close();
    }

    this.transform.writable.close();

    this.closed = true;
  }

  isClosed() {
    return this.closed;
  }
}

export class CloneStream<ChunkType> {
  private transformStream = new TransformStream(
    new PassThroughTransformer<ChunkType>(),
  );
  private sourceReadable = this.transformStream.readable;

  writable = this.transformStream.writable;

  getReadableStream() {
    const [r1, r2] = this.sourceReadable.tee();

    this.sourceReadable = r1;

    return r2;
  }
}

// Only gets chunks from the writable end AFTER the readable stream is constructed.
export class CloneMidStream<ChunkType> {
  private closed = false;

  private subscribers: {
    transform: TransformStream<ChunkType>;
    writer: WritableStreamDefaultWriter<ChunkType>;
  }[] = [];

  private writables: WritableStream<ChunkType>[] = [];

  private checkClosed() {
    if (this.closed) {
      throw "Closed";
    }
  }

  writable: WritableStream<ChunkType>;

  constructor() {
    const subscribers = this.subscribers;

    this.writable = new WritableStream({
      write(chunk) {
        const notifies = subscribers.map(({ writer }) => {
          return new Promise<void>((resolve) => {
            writer.ready.then(() => {
              writer.write(chunk).then(resolve);
            });
          });
        });

        Promise.all(notifies);
      },
    });
  }

  getReadableStream() {
    this.checkClosed();

    const transform = new TransformStream<ChunkType, ChunkType>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
      },
    });

    this.subscribers.push({
      transform,
      writer: transform.writable.getWriter(),
    });

    return transform.readable;
  }

  async close() {
    this.checkClosed();

    for (const writableStream of this.writables) {
      await writableStream.close();
    }

    for (const { transform } of this.subscribers) {
      await transform.writable.close();
      await transform.readable.cancel();
    }

    this.closed = true;
  }

  isClosed() {
    return this.closed;
  }
}

export class MultiStream<T> {
  private closed = false;

  private combineStream = new CombineStream<T>();
  private cloneStream: CloneStream<T> | CloneMidStream<T>;

  private checkClosed() {
    if (this.closed) {
      throw "Closed";
    }
  }

  constructor(joinMidStream?: boolean) {
    if (joinMidStream) {
      this.cloneStream = new CloneMidStream();
    } else {
      this.cloneStream = new CloneStream();
    }

    this.combineStream.readable.pipeTo(this.cloneStream.writable);
  }

  getWritableStream() {
    return this.combineStream.getWritableStream();
  }

  getReadableStream() {
    return this.cloneStream.getReadableStream();
  }

  close() {
    this.checkClosed();

    this.combineStream.close();
    //this.cloneStream.close();

    this.closed = true;
  }

  isClosed() {
    return this.closed;
  }
}

export class CallbackSink<T> implements UnderlyingSink<T> {
  private callbacks = new Set<(chunk: T) => void | Promise<void>>();

  onWrite(callback: (chunk: T) => void | Promise<void>): () => void {
    this.callbacks.add(callback);

    return () => {
      this.callbacks.delete(callback);
    };
  }

  async write(chunk: T) {
    for (const callback of this.callbacks) {
      await callback(chunk);
    }
  }

  close() {
    this.callbacks.clear();
  }
}

// This bus runs all its callbacks blockingly, so that no two subscribed callbacks are ever called at the same time.
export class BlockingBus<T> {
  private callbacks = new Set<(item: T) => void | Promise<void>>();
  private lock = new LockStream();

  on(cb: (item: T) => void | Promise<void>) {
    this.callbacks.add(cb);

    return () => {
      this.callbacks.delete(cb);
    };
  }

  async send(item: T) {
    for (const callback of this.callbacks) {
      await this.lock.run(() => callback(item));
    }
  }
}

export class PassThroughTransformer<ChunkType>
  implements Transformer<ChunkType, ChunkType> {
  transform(
    chunk: ChunkType,
    controller: TransformStreamDefaultController<ChunkType>,
  ) {
    controller.enqueue(chunk);
  }
}

export class LockStream {
  private writable = new WritableStream<() => void | Promise<void>>({
    async write(cb) {
      await cb();
    },
  });

  private writer = this.writable.getWriter();

  private closed = false;

  private checkClosed() {
    if (this.closed) {
      throw "Closed";
    }
  }

  async run(cb: () => void | Promise<void>) {
    this.checkClosed();

    await this.writer.ready;

    return this.writer.write(cb);
  }

  async close() {
    this.checkClosed();

    await this.writable.close();

    this.closed = true;
  }

  isClosed() {
    return this.closed;
  }
}

export type OrCh<Ch extends string> = "*" | Ch;

export type Channelled<ChannelType extends string, KeyType extends string> = {
  [Key in KeyType]: OrCh<ChannelType>;
};

export class ChannelTransformer<
  ChannelType extends string,
  KeyType extends string,
  ItemType extends Channelled<ChannelType, KeyType>,
> implements Transformer<ItemType, ItemType> {
  private channel: ChannelType;
  private channelKey: KeyType;

  constructor(channel: ChannelType, key: KeyType) {
    this.channel = channel;
    this.channelKey = key;
  }

  transform(
    chunk: ItemType,
    controller: TransformStreamDefaultController<ItemType>,
  ) {
    if (this.channel === "*" || this.channel === chunk[this.channelKey]) {
      controller.enqueue(chunk);
      return;
    }
  }
}

export class ChannelMultiStream<
  ChannelType extends string,
  KeyType extends string,
  ItemType extends Channelled<ChannelType, KeyType>,
> {
  private multistream: MultiStream<ItemType>;
  private channelKey: KeyType;

  constructor(key: KeyType, joinMidStream?: boolean) {
    this.multistream = new MultiStream(joinMidStream);
    this.channelKey = key;
  }

  getWritableStream(): WritableStream<ItemType> {
    return this.multistream.getWritableStream();
  }

  getReadableStream(
    channel: OrCh<ChannelType>,
  ): ReadableStream<ItemType> {
    const channelTransform = new TransformStream(
      new ChannelTransformer<OrCh<ChannelType>, KeyType, ItemType>(
        channel,
        this.channelKey,
      ),
    );

    return this.multistream.getReadableStream().pipeThrough(channelTransform);
  }
}

export class StreamSplitter<ChunkType> {
  private transforms = new Map<
    string,
    TransformStream<ChunkType, ChunkType>
  >();

  private incomingCloner = new CloneStream<ChunkType>();

  writable = this.incomingCloner.writable;

  private getKey: (chunk: ChunkType) => string | undefined;

  constructor(getKey: (chunk: ChunkType) => string | undefined) {
    this.getKey = getKey;
  }

  getReadable(key: string): ReadableStream<ChunkType> {
    const { transforms, incomingCloner, getKey } = this;

    const transform = transforms.get(key);

    if (!transform) {
      const incomingClone = incomingCloner.getReadableStream();

      const newTransform = new TransformStream<ChunkType, ChunkType>(
        new PassThroughTransformer(),
      );

      const filterTransform = new TransformStream<ChunkType, ChunkType>({
        transform(chunk, controller) {
          if (getKey(chunk) === key) {
            controller.enqueue(chunk);
          }
        },
      });

      incomingClone.pipeThrough(filterTransform).pipeTo(newTransform.writable)
        .catch((err) => {
          newTransform.writable.abort(err);
        });

      transforms.set(key, newTransform);

      return newTransform.readable;
    }

    return transform.readable;
  }
}

export function websocketWritable<
  T,
>(
  socket: WebSocket,
  prepareToSend: (
    outgoing: T,
  ) => string | ArrayBufferLike | Blob | ArrayBufferView,
) {
  // set socket binary type
  socket.binaryType = "arraybuffer";

  const socketIsOpen = deferred();
  // check if socket is open

  // set socket.onopen
  if (socket.readyState === socket.OPEN) {
    socketIsOpen.resolve();
  }

  socket.onopen = () => {
    socketIsOpen.resolve();
  };

  return new WritableStream<T>({
    async write(chunk, controller) {
      // await
      await socketIsOpen;

      // try to send
      try {
        const toSend = prepareToSend(chunk);

        socket.send(toSend);
      } catch (err) {
        controller.error(err);
      }
      // catch and error controller

      socket.onclose = () => {
        controller.error("Socket closed before we were done");
      };
    },

    close() {
      socket.close();
    },

    abort() {
      socket.close(1001, "Aborting");
    },
  });
}

export function websocketReadable<
  T,
>(
  socket: WebSocket,
  prepareForQueue: (event: MessageEvent<any>) => T,
) {
  // set socket binary type
  socket.binaryType = "arraybuffer";

  let erroredOutAlready = false;

  return new ReadableStream<T>({
    start(controller) {
      socket.onmessage = (event) => {
        const toQueue = prepareForQueue(event);

        controller.enqueue(toQueue);
      };

      socket.onclose = () => {
        if (erroredOutAlready) {
          return;
        }

        controller.close();
      };

      socket.onerror = (err) => {
        erroredOutAlready = true;
        controller.error(err);
      };
    },
  });
}
