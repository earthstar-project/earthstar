export interface ITcpConn {
  read(bytes: Uint8Array): Promise<number | null>;
  write(bytes: Uint8Array): Promise<number | null>;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close(): void;
  remoteAddr: {
    hostname: string;
    port: number;
  };
}

export interface ITcpListener extends AsyncIterable<ITcpConn> {
  close(): void;
}

export interface ITcpProvider {
  listen(opts: { port: number }): ITcpListener;
  connect(opts: { port: number; hostname: string }): Promise<ITcpConn>;
}
