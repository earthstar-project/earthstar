import { build } from "https://deno.land/x/dnt@0.15.0/mod.ts";

await Deno.remove("npm", { recursive: true }).catch((_) => {});

await build({
  entryPoints: ["./mod.ts", "./src/entries/node.ts"],
  outDir: "./npm",
  shims: {
    deno: {
      test: "dev",
    },
    weakRef: true,
    custom: [
      {
        package: {
          name: "@ungap/structured-clone",
          version: "0.3.4",
        },
        globalNames: ["structuredClone"],
      },
    ],
    customDev: [
      {
        package: {
          name: "@types/ungap__structured-clone",
        },
        globalNames: [],
      },
      {
        package: {
          name: "@types/chloride",
          version: "2.4.0",
        },
        globalNames: [],
      },
    ],
  },
  compilerOptions: {
    // This is for Node v14 support
    target: "ES2020",
  },
  mappings: {
    "https://deno.land/x/crayon_chalk_aliases@1.1.0/index.ts": {
      name: "chalk",
      version: "4.1.2",
    },
    "https://cdn.skypack.dev/concurrency-friends@5.2.0?dts": {
      name: "concurrency-friends",
      version: "5.2.0",
    },
    "./src/node/chloride.ts": {
      name: "chloride",
      version: "2.4.1",
    },
    "https://raw.githubusercontent.com/sgwilym/noble-ed25519/7af9329476ff2f2a0e524a9f78e36d09704efc63/mod.ts":
      {
        name: "@noble/ed25519",
        version: "1.4.0",
      },
  },
  package: {
    // package.json properties
    name: "stone-soup",
    version: Deno.args[0],
    description: "A distributed, syncable key-value database",
    license: "AGPL-3.0",
    repository: {
      type: "git",
      url: "git+https://github.com/earthstar-project/stone-soup.git",
    },
    bugs: {
      url: "https://github.com/earthstar-project/stone-soup/issues",
    },
  },
  // tsc includes 'dom' as a lib, so doesn't need IndexedDB types
  redirects: {
    "./src/storage/indexeddb-types.deno.d.ts":
      "./src/storage/indexeddb-types.node.d.ts",
  },
});

// post build steps
Deno.copyFileSync("LICENSE", "npm/LICENSE");
Deno.copyFileSync("README.md", "npm/README.md");
