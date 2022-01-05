import { build } from "https://deno.land/x/dnt/mod.ts";

await Deno.remove("npm", { recursive: true }).catch((_) => {});

await build({
  entryPoints: ["./mod.ts"],
  outDir: "./npm",
  shims: {
    deno: true,
  },
  redirects: {
    "./src/storage/indexeddb-types.deno.ts":
      "./src/storage/indexeddb-types.node.ts",
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
