import { build } from "https://deno.land/x/dnt@0.16.1/mod.ts";

await Deno.remove("npm", { recursive: true }).catch((_) => {});

await build({
    entryPoints: [
        "./src/entries/universal.ts",
        "./src/entries/node.ts",
        "./src/entries/browser.ts",
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
    mappings: {
        "https://raw.githubusercontent.com/earthstar-project/earthstar-streaming-rpc/v3.2.0/mod.browser.ts":
            {
                name: "earthstar-streaming-rpc",
                version: "3.2.0",
            },
        "https://esm.sh/earthstar-streaming-rpc@3.2.0?dts": {
            name: "earthstar-streaming-rpc",
            version: "3.2.0",
        },
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
    },
    package: {
        // package.json properties
        name: "stone-soup",
        version: Deno.args[0],
        description: "A distributed, syncable key-value database",
        license: "LGPL-3.0-only",
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
        "./src/storage/indexeddb-types.deno.d.ts": "./src/storage/indexeddb-types.node.d.ts",
        "./src/test/transport-scenarios/transport-scenarios.ts":
            "./src/test/transport-scenarios/transport-scenarios.node.ts",
        "./src/test/peer-sync-scenarios/peer-sync-scenarios.ts":
            "./src/test/peer-sync-scenarios/peer-sync-scenarios.node.ts",
        "./src/storage/storage-driver-sqlite.deno.ts":
            "./src/storage/storage-driver-sqlite.node.ts",
        "./src/test/test-deps.ts": "./src/test/test-deps.node.ts",
    },
});

// post build steps
Deno.copyFileSync("LICENSE", "npm/LICENSE");
Deno.copyFileSync("README.md", "npm/README.md");
