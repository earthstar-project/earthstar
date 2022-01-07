import { build } from "https://deno.land/x/dnt@0.13.0/mod.ts";

await Deno.remove("npm", { recursive: true }).catch((_) => {});

await build({
    entryPoints: ["./mod.ts", "./src/entries/node.ts"],
    outDir: "./npm",
    shims: {
        deno: {
            test: "dev",
        },
        customDev: [
            {
                package: {
                    name: "@types/chloride",
                    version: "2.4.0",
                },
                globalNames: [],
            },
        ],
    },
    mappings: {
        "https://deno.land/x/crayon_chalk_aliases/index.ts": {
            name: "chalk",
            version: "4.1.1",
        },
        "https://cdn.skypack.dev/concurrency-friends@5.2.0?dts": {
            name: "concurrency-friends",
            version: "5.2.0",
        },
        "./src/node/chloride.ts": {
            name: "chloride",
            version: "2.4.1",
        },
    },
    package: {
        // package.json properties
        name: "stone-soup",
        version: Deno.args[0],
        description: "Your package.",
        license: "MIT",
        repository: {
            type: "git",
            url: "git+https://github.com/username/package.git",
        },
        bugs: {
            url: "https://github.com/username/package/issues",
        },
    },
});

// post build steps
Deno.copyFileSync("LICENSE", "npm/LICENSE");
Deno.copyFileSync("README.md", "npm/README.md");
