/// <reference types="@types/node" />

import { ITcpConn, ITcpListener, ITcpProvider } from "./types.ts";
import { createConnection, createServer, Server, Socket } from "node:net";

import { AsyncQueue, Deferred, deferred } from "../../deps.ts";

export class TcpProvider implements ITcpProvider {
  listen(opts: { port: number }): TcpListener {
    const server = createServer();

    server.listen(opts.port);

    return new TcpListener(server);
  }
  connect(opts: { port: number; hostname: string }): Promise<ITcpConn> {
    // console.log("creating connection", opts);

    const socket = createConnection(opts);

    return Promise.resolve(new TcpConn(socket));
  }
}

export class TcpListener implements ITcpListener {
  server: Server;

  private connQueue = new AsyncQueue<Socket>();

  constructor(server: Server) {
    this.server = server;

    this.server.on("connection", (socket: Socket) => {
      this.connQueue.push(socket);
    });
  }

  close(): void {
    this.server.close();
  }

  async *[Symbol.asyncIterator]() {
    for await (const socket of this.connQueue) {
      yield new TcpConn(socket);
    }
  }
}

// A thing where you make a request for some number of bytes.

class SocketReader {
  private promiseQueue: {
    desiredLength: number | undefined;
    promise: Deferred<Uint8Array>;
  }[] = [];

  private socket: Socket;

  constructor(socket: Socket) {
    this.socket = socket;

    socket.on("readable", () => {
      this.runQueue();
    });

    socket.on("end", () => {
      this.flush();
    });
  }

  runQueue() {
    while (this.promiseQueue.length > 0) {
      const item = this.promiseQueue[0]!;

      const bytes = this.socket.read(item.desiredLength) as Uint8Array;

      if (bytes) {
        //console.log("resolved bytes", bytes.byteLength);
        item.promise.resolve(bytes);
        this.promiseQueue.shift();
      } else {
        break;
      }
    }
  }

  flush() {
    const [head] = this.promiseQueue!;

    const bytes = this.socket.read(undefined) as Uint8Array;

    if (bytes) {
      // console.log("flushed", bytes.byteLength);
      head.promise.resolve(bytes);
    } else {
      for (const item of this.promiseQueue) {
        // item.promise.reject("No data");
      }
    }
  }

  getBytes(len?: number): Promise<Uint8Array> {
    // Adds a promise to a chain
    const promise = deferred<Uint8Array>();

    this.promiseQueue.push({
      desiredLength: len || undefined,
      promise,
    });

    this.runQueue();

    return promise;
  }
}

class TcpConn implements ITcpConn {
  private socket: Socket;

  writable: WritableStream<Uint8Array>;

  //  isReady = deferred();

  private socketReader: SocketReader;

  id = Math.random();

  constructor(socket: Socket) {
    this.socket = socket;

    this.socketReader = new SocketReader(socket);

    socket.on("error", () => {
      this.writable.abort();
      this.readable.cancel();
    });

    /*
    if (socket.readyState === "open") {
      this.isReady.resolve();
    }

    socket.on("ready", () => {
      this.isReady.resolve();
    });
    */

    // const isReady = (() => this.isReady).bind(this);

    this.writable = new WritableStream({
      async write(chunk) {
        //   await isReady();

        const hasWritten = deferred();

        socket.write(chunk, () => {
          hasWritten.resolve();
        });

        await hasWritten;
      },
      close() {
        socket.destroy();
      },
      abort() {
        socket.destroy();
      },
    });
  }

  // This is a getter (rather than constructed when TcpProvider is instantiated) because we want the controller to only start pulling when the readable is called for.
  get readable() {
    const getBytes = this.socketReader.getBytes.bind(this.socketReader);
    const socket = this.socket;

    //  const isReady = (() => this.isReady).bind(this);

    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        // await isReady();

        const bytes = await getBytes();

        if (bytes) {
          controller.enqueue(bytes);
        }
      },
      cancel() {
        socket.destroy();
      },
    });
  }

  async read(bytes: Uint8Array): Promise<number | null> {
    //    await this.isReady;

    const result = await this.socketReader.getBytes(bytes.byteLength);

    bytes.set(result, 0);

    return result.byteLength;
  }

  async write(bytes: Uint8Array): Promise<number | null> {
    //   await this.isReady;

    const wrotePromise = deferred<number>();

    this.socket.write(bytes, () => {
      wrotePromise.resolve();
    });

    return wrotePromise;
  }

  close() {
    return this.socket.destroy();
  }

  get remoteAddr() {
    return {
      hostname: this.socket.remoteAddress || "Destroyed",
      port: this.socket.remotePort || 0,
    };
  }
}
