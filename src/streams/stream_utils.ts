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
        writer.write(chunk);
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

export class CloneStream<T> {
  private closed = false;

  private subscribers: {
    transform: TransformStream<T>;
    writer: WritableStreamDefaultWriter<T>;
  }[] = [];

  private writables: WritableStream<T>[] = [];

  private checkClosed() {
    if (this.closed) {
      throw "Closed";
    }
  }

  writable: WritableStream<T>;

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

    const transform = new TransformStream<T, T>({
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
  private cloneStream = new CloneStream<T>();

  private checkClosed() {
    if (this.closed) {
      throw "Closed";
    }
  }

  constructor() {
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
    this.cloneStream.close();

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

    this.writer.write(cb);
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
  private multistream = new MultiStream<ItemType>();
  private channelKey: KeyType;

  constructor(key: KeyType) {
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
