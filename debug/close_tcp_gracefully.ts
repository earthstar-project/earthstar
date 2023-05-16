const SIZE = 800000;

const listener = Deno.listen({ port: 17171 });

(async () => {
  for await (const conn of listener) {
    const id = Math.round(Math.random() * 100);

    let total = 0;

    conn.readable.pipeTo(
      new WritableStream({
        write(chunk) {
          total += chunk.byteLength;

          console.log(id, "got", chunk.byteLength, "bytes...");

          if (total >= SIZE) {
            console.log(id, "got everything!");
            conn.close();
          }
        },
      }),
    );
  }
})();

async function run(id: number) {
  const conn = await Deno.connect({ port: 17171 });

  const chunk = new Uint8Array(SIZE);

  // Send a big
  await conn.write(chunk);

  console.log(id, `sent`, chunk.byteLength, "bytes");

  conn.close();
}

for (const num of [1, 2, 3, 4, 5]) {
  run(num);
}
