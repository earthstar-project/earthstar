import { build } from "https://deno.land/x/dnt@0.34.0/mod.ts";

await Deno.remove("npm", { recursive: true }).catch((_) => {});

await build({
  entryPoints: [
    { name: ".", path: "./src/entries/universal.ts" },
    { name: "./node", path: "./src/entries/node.ts" },
    { name: "./browser", path: "./src/entries/browser.ts" },
  ],
  //testPattern: "**/!(sync_fs)/*.test.{ts,tsx,js,mjs,jsx}",
  testPattern: "**/syncer/*.test.{ts}",
  outDir: "./npm",
  compilerOptions: {
    lib: ["dom", "es2021"],
  },
  shims: {
    deno: "dev",
    timers: true,
    weakRef: true,
    crypto: "dev",
    custom: [
      {
        package: {
          name: "isomorphic-blob",
          version: "1.0.1",
        },

        globalNames: ["Blob"],
      },
      {
        package: {
          name: "isomorphic-undici-ponyfill",
          version: "1.0.0",
        },
        globalNames: [
          "Request",
          "Response",
          "Headers",
        ],
      },
      {
        package: {
          name: "@sgwilym/isomorphic-streams",
          version: "1.0.4",
        },
        globalNames: [
          "WritableStream",
          "TransformStream",
          "ReadableStream",
          "TransformStreamDefaultController",
          { name: "UnderlyingSink", typeOnly: true },
          "WritableStreamDefaultWriter",
        ],
      },
      {
        package: {
          name: "isomorphic-ws",
          version: "5.0.0",
        },
        globalNames: [{ name: "WebSocket", exportName: "default" }],
      },
      {
        package: {
          name: "textencoder-ponyfill",
          version: "1.0.2",
        },
        globalNames: ["TextEncoder", "TextDecoder"],
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
    ],
  },

  mappings: {
    "./src/test/scenarios/scenarios.ts":
      "./src/test/scenarios/scenarios.node.ts",

    "./src/discovery/tcp_provider.ts": "./src/discovery/tcp_provider.node.ts",

    "./src/node/chloride.ts": {
      name: "chloride",
      version: "2.4.1",
    },

    "./src/crypto/default_driver.ts": "./src/crypto/default_driver.npm.ts",

    "./src/replica/driver_fs.ts": "./src/replica/driver_fs.node.ts",
    "https://esm.sh/better-sqlite3?dts": {
      name: "better-sqlite3",
      version: "7.5.0",
    },
    "https://raw.githubusercontent.com/sgwilym/noble-ed25519/153f9e7e9952ad22885f5abb3f6abf777bef4a4c/mod.ts":
      {
        name: "@noble/ed25519",
        version: "1.6.0",
      },
    "https://esm.sh/path-to-regexp@6.2.1": {
      name: "path-to-regexp",
      version: "6.2.1",
    },
    "https://deno.land/std@0.154.0/node/fs/promises.ts": {
      name: "node:fs/promises",
    },
    "https://deno.land/std@0.154.0/node/path.ts": {
      name: "node:path",
    },
    "https://esm.sh/@nodelib/fs.walk@1.2.8": {
      name: "@nodelib/fs.walk",
      version: "1.2.8",
    },
    "https://esm.sh/ws@8.8.1": {
      name: "ws",
      version: "8.8.1",
    },
    "../dns-sd/mod.ts": {
      name: "ya-dns-sd",
      version: "2.0.0-test1",
    },

    "https://deno.land/std@0.167.0/node/http.ts": "node:http",
    "https://deno.land/std@0.167.0/node/buffer.ts": "node:buffer",
  },
  package: {
    // package.json properties
    name: "earthstar",
    version: Deno.args[0],
    engines: {
      node: ">=16.0.0",
    },
    description:
      "Earthstar is a tool for private, undiscoverable, offline-first networks.",
    license: "LGPL-3.0-only",
    homepage: "https://earthstar-project.org",
    funding: {
      type: "opencollective",
      url: "https://opencollective.com/earthstar",
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
      "@types/ws": "8.5.3",
      "@types/node": "20.1.1",
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
