import { build } from "https://deno.land/x/dnt@0.29.1/mod.ts";

await Deno.remove("npm", { recursive: true }).catch((_) => {});

await build({
  entryPoints: [
    { name: ".", path: "./src/entries/universal.ts" },
    { name: "./node", path: "./src/entries/node.ts" },
    { name: "./browser", path: "./src/entries/browser.ts" },
  ],
  testPattern: "**/!(sync_fs)/*.test.{ts,tsx,js,mjs,jsx}",
  outDir: "./npm",
  compilerOptions: {
    //lib: ["dom", "es2021"],
  },
  shims: {
    deno: true,
    undici: true,
    webSocket: true,
    timers: true,
    weakRef: true,
    crypto: true,
    custom: [
      {
        module: "node:stream/web",
        globalNames: [
          "WritableStream",
          "TransformStream",
          "ReadableStream",
          { name: "Transformer", typeOnly: true },
          "TransformStreamDefaultController",
          { name: "UnderlyingSink", typeOnly: true },
          "WritableStreamDefaultWriter",
        ],
      },
      {
        package: {
          name: "@sgwilym/urlpattern-polyfill",
          version: "1.0.0-rc8",
        },
        globalNames: [{
          name: "URLPattern",
          exportName: "URLPattern",
        }],
      },
      {
        globalNames: ["TextEncoder", "TextDecoder"],
        module: "util",
      },
    ],
  },

  mappings: {
    "./src/test/scenarios/scenarios.ts":
      "./src/test/scenarios/scenarios.node.ts",

    "./src/node/chloride.ts": {
      name: "chloride",
      version: "2.4.1",
    },
    "https://esm.sh/better-sqlite3?dts": {
      name: "better-sqlite3",
      version: "7.5.0",
    },
    "https://raw.githubusercontent.com/sgwilym/noble-ed25519/153f9e7e9952ad22885f5abb3f6abf777bef4a4c/mod.ts":
      {
        name: "@noble/ed25519",
        version: "1.6.0",
      },
    /* TODO: Bring back with IndexedDB
    "./src/replica/indexeddb-types.deno.d.ts":
      "./src/replica/indexeddb-types.node.d.ts",
    "./src/test/scenarios/scenarios.ts":
      "./src/test/scenarios/scenarios.node.ts",
      */
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
