import { build } from "https://deno.land/x/dnt@0.13.0/mod.ts";

await Deno.remove("npm", { recursive: true }).catch((_) => {});

await build({
    entryPoints: ["./mod.ts"],
    outDir: "./npm",
    shims: {
        deno: {
            test: "dev",
        },
    },
    mappings: {
        "https://deno.land/x/chalk_deno@v4.1.1-deno/source/index.js": {
            name: "chalk",
            version: "4.1.1",
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
