import { build } from "https://deno.land/x/dnt@0.21.0/mod.ts";

await Deno.remove("npm", { recursive: true }).catch((_) => {});

await build({
    entryPoints: [
        { name: ".", path: "./src/entries/universal.ts" },
        { name: "./node", path: "./src/entries/node.ts" },
        { name: "./browser", path: "./src/entries/browser.ts" },
    ],
    outDir: "./npm",
    shims: {
        deno: {
            test: "dev",
        },
        timers: true,
        weakRef: true,
        custom: [
            {
                package: {
                    name: "@ungap/structured-clone",
                    version: "0.3.4",
                },
                globalNames: [{ name: "structuredClone", exportName: "default" }],
            },
        ],
        customDev: [
            {
                package: {
                    name: "@types/chloride",
                    version: "2.4.0",
                },
                globalNames: [],
            },
            {
                package: {
                    name: "@types/better-sqlite3",
                    version: "7.4.2",
                },
                globalNames: [],
            },
            {
                package: {
                    name: "@types/express",
                    version: "4.17.13",
                },
                globalNames: [],
            },
            {
                package: {
                    name: "@types/node-fetch",
                    version: "2.5.12",
                },
                globalNames: [],
            },
        ],
    },
    compilerOptions: {
        // This is for Node v14 support
        target: "ES2020",
    },
    // typeCheck: false,
    mappings: {
        "https://esm.sh/earthstar-streaming-rpc@4.0.1": {
            name: "earthstar-streaming-rpc",
            version: "4.0.1",
        },
        "https://deno.land/x/earthstar_streaming_rpc@v4.0.1/src/entries/node.ts": {
            name: "earthstar-streaming-rpc",
            version: "4.0.1",
            subPath: "node",
        },
        "./src/streaming_rpc/streaming_rpc.ts": "./src/streaming_rpc/streaming_rpc.node.ts",
        "https://esm.sh/express?dts": {
            name: "express",
            version: "4.17.2",
        },
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
        "https://esm.sh/better-sqlite3?dts": {
            name: "better-sqlite3",
            version: "7.5.0",
        },
        "https://raw.githubusercontent.com/sgwilym/noble-ed25519/7af9329476ff2f2a0e524a9f78e36d09704efc63/mod.ts":
            {
                name: "@noble/ed25519",
                version: "1.4.0",
            },
        "./src/replica/indexeddb-types.deno.d.ts": "./src/replica/indexeddb-types.node.d.ts",
        "./src/test/transport-scenarios/transport-scenarios.ts":
            "./src/test/transport-scenarios/transport-scenarios.node.ts",
        "./src/test/peer-sync-scenarios/peer-sync-scenarios.ts":
            "./src/test/peer-sync-scenarios/peer-sync-scenarios.node.ts",
        "./src/replica/replica-driver-sqlite.deno.ts":
            "./src/replica/replica-driver-sqlite.node.ts",
        "./src/test/test-deps.ts": "./src/test/test-deps.node.ts",
    },
    package: {
        // package.json properties
        name: "earthstar",
        version: Deno.args[0],
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
