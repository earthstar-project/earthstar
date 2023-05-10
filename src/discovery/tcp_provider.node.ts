/// <reference types="@types/node" />

import { ITcpConn, ITcpListener, ITcpProvider } from "./types.ts";
import { createConnection, createServer, Server, Socket } from "node:net";

import { concat, Deferred, deferred } from "../../deps.ts";

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

class TcpListener implements ITcpListener {
  server: Server;

  constructor(server: Server) {
    this.server = server;
  }

  close(): void {
    this.server.close();
  }

  async *[Symbol.asyncIterator]() {
    let socketPromise = deferred<Socket>();

    this.server.on("connection", (socket: Socket) => {
      socketPromise.resolve(socket);
    });

    while (true) {
      // console.log("waiting for connection...");
      const socket = await socketPromise;
      // console.log("got connection");

      socketPromise = deferred<Socket>();

      yield new TcpConn(socket);
    }
  }
}

// A thing where you make a request for some number of bytes.

class ByteFeeder {
  private promiseQueue: {
    desiredLength: number;
    promise: Deferred<Uint8Array>;
  }[] = [];

  private buffer = new Uint8Array(0);

  addBytes(bytes: Uint8Array) {
    // console.group("Received bytes", bytes.byteLength);

    let remainingBytes = concat(this.buffer, bytes);

    while (this.promiseQueue.length > 0) {
      const item = this.promiseQueue[0]!;

      // console.log("Checking for bytes for item...", item.desiredLength);

      if (item.desiredLength === -1 && remainingBytes.byteLength > 0) {
        // console.log("Fulfilled greedy request", remainingBytes.byteLength);

        this.promiseQueue.shift();
        item.promise.resolve(remainingBytes);

        remainingBytes = new Uint8Array(0);

        break;
      } else if (
        item.desiredLength > 0 &&
        remainingBytes.byteLength >= item.desiredLength
      ) {
        /*
        console.log(
          "Fulfilled limited request",
          item.desiredLength,
          remainingBytes,
        );
        */

        const fulfilledBytes = remainingBytes.subarray(0, item.desiredLength);

        remainingBytes = remainingBytes.subarray(item.desiredLength);

        this.promiseQueue.shift();
        item.promise.resolve(fulfilledBytes);
      } else {
        /*
       console.log(
          "Not enough bytes for this...",
          item.desiredLength,
          ">",
          remainingBytes.byteLength,
        );
        */

        break;
      }
    }

    // console.groupEnd();

    this.buffer = remainingBytes;
  }

  getBytes(len?: number): Promise<Uint8Array> {
    // Adds a promise to a chain
    const promise = deferred<Uint8Array>();

    this.promiseQueue.push({
      desiredLength: len || -1,
      promise,
    });

    // console.log("Got request for bytes", len || -1);

    this.addBytes(new Uint8Array(0));

    return promise;
  }
}

class TcpConn implements ITcpConn {
  private socket: Socket;

  writable: WritableStream<Uint8Array>;

  isReady = deferred();

  private byteFeeder = new ByteFeeder();

  id = Math.random();

  constructor(socket: Socket) {
    this.socket = socket;

    console.log(socket.readyState);

    if (socket.readyState === "open") {
      this.isReady.resolve();
    }

    socket.on("ready", () => {
      this.isReady.resolve();
    });

    socket.on("data", (chunk: Uint8Array) => {
      this.byteFeeder.addBytes(chunk);
    });

    socket.on("end", () => {
      this.byteFeeder.addBytes(new Uint8Array(0));
    });

    this.isReady.then(() => {
      this.byteFeeder.addBytes(new Uint8Array(0));
    });

    const isReady = (() => this.isReady).bind(this);

    this.writable = new WritableStream({
      async write(chunk) {
        await isReady();

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
    const getBytes = this.byteFeeder.getBytes.bind(this.byteFeeder);
    const socket = this.socket;

    const isReady = (() => this.isReady).bind(this);

    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        await isReady();

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
    await this.isReady;

    const result = await this.byteFeeder.getBytes(bytes.byteLength);

    bytes.set(result, 0);

    return result.byteLength;
  }

  async write(bytes: Uint8Array): Promise<number | null> {
    await this.isReady;

    const wrotePromise = deferred<number>();

    this.socket.write(bytes, () => {
      wrotePromise.resolve();
    });

    return wrotePromise;
  }

  close() {
    // return this.socket.destroy();
  }

  get remoteAddr() {
    return {
      hostname: this.socket.remoteAddress || "Destroyed",
      port: this.socket.remotePort || 0,
    };
  }
}
