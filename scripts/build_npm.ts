import { build } from "https://deno.land/x/dnt@0.23.0/mod.ts";

await Deno.remove("npm", { recursive: true }).catch((_) => {});

await build({
  entryPoints: [
    { name: ".", path: "./src/entries/universal.ts" },
    { name: "./node", path: "./src/entries/node.ts" },
    { name: "./browser", path: "./src/entries/browser.ts" },
  ],
  testPattern: "**/!(sync_fs)/*.test.{ts,tsx,js,mjs,jsx}",
  outDir: "./npm",
  shims: {
    deno: {
      test: "dev",
    },
    undici: true,
    webSocket: true,
    timers: true,
    weakRef: true,
    custom: [
      {
        module: "node:stream/web",
        globalNames: ["WritableStream", "TransformStream", "ReadableStream"],
      },
    ],
  },

  // typeCheck: false,
  mappings: {
    // "./src/entries/deno.ts": "./src/entries/node.ts",
    "https://deno.land/x/crayon_chalk_aliases@1.1.0/index.ts": {
      name: "chalk",
      version: "4.1.2",
    },

    "./src/node/chloride.ts": {
      name: "chloride",
      version: "2.4.1",
    },
    "https://esm.sh/better-sqlite3?dts": {
      name: "better-sqlite3",
      version: "7.5.0",
    },
    "https://raw.githubusercontent.com/sgwilym/noble-ed25519/7af9329476ff2f2a0e524a9f78e36d09704efc63/mod.ts":
      {
        name: "@noble/ed25519",
        version: "1.4.0",
      },
    "./src/replica/indexeddb-types.deno.d.ts":
      "./src/replica/indexeddb-types.node.d.ts",
    "./src/test/scenarios/scenarios.ts":
      "./src/test/scenarios/scenarios.node.ts",
  },
  package: {
    // package.json properties
    name: "earthstar",
    version: Deno.args[0],
    "engines": {
      "node": ">=14.19.1",
    },
    description:
      "Earthstar is a specification and Javascript library for building online tools you can truly call your own.",
    license: "LGPL-3.0-only",
    homepage: "https://earthstar-project.org",
    "funding": {
      "type": "opencollective",
      "url": "https://opencollective.com/earthstar",
    },
    repository: {
      type: "git",
      url: "git+https://github.com/earthstar-project/earthstar.git",
    },
    bugs: {
      url: "https://github.com/earthstar-project/earthstar/issues",
    },
    devDependencies: {
      "@types/better-sqlite3": "7.4.2",
      "@types/chloride": "2.4.0",
      "@types/node-fetch": "2.5.12",
    },
  },
});

// post build steps
Deno.copyFileSync("LICENSE", "npm/LICENSE");
Deno.copyFileSync("README.md", "npm/README.md");

// A truly filthy hack to compensate for Typescript's lack of support for the exports field
Deno.writeTextFileSync(
  "npm/browser.js",
  `export * from "./esm/src/entries/browser";`,
);

Deno.writeTextFileSync(
  "npm/browser.d.ts",
  `export * from './types/src/entries/browser';`,
);

Deno.writeTextFileSync(
  "npm/node.js",
  `export * from "./esm/src/entries/node";`,
);

Deno.writeTextFileSync(
  "npm/node.d.ts",
  `export * from './types/src/entries/node';`,
);
