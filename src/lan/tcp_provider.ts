import { ITcpConn, ITcpListener, ITcpProvider } from "./types.ts";

export class TcpProvider implements ITcpProvider {
  listen(opts: { port: number }): TcpListener {
    return new TcpListener(Deno.listen(opts));
  }
  async connect(opts: { port: number; hostname: string }): Promise<ITcpConn> {
    const conn = await Deno.connect(opts);

    return new TcpConn(conn);
  }
}

class TcpListener implements ITcpListener {
  listener: Deno.Listener;

  constructor(listener: Deno.Listener) {
    this.listener = listener;
  }

  close(): void {
    this.listener.close();
  }

  async *[Symbol.asyncIterator]() {
    for await (const conn of this.listener) {
      yield new TcpConn(conn);
    }
  }
}

class TcpConn implements ITcpConn {
  private conn: Deno.Conn;

  constructor(conn: Deno.Conn) {
    this.conn = conn;
  }

  read(bytes: Uint8Array): Promise<number | null> {
    return this.conn.read(bytes);
  }

  write(bytes: Uint8Array): Promise<number | null> {
    return this.conn.write(bytes);
  }

  close() {
    return this.conn.close();
  }

  get readable() {
    return this.conn.readable;
  }

  get writable() {
    return this.conn.writable;
  }

  get remoteAddr() {
    return this.conn.remoteAddr as Deno.NetAddr;
  }
}
