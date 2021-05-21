import esbuild from "esbuild";

const externals = [
  "chalk",
  "chloride",
  "fast-deep-equal",
  "fast-json-stable-stringify",
  "rfc4648",
  "rfdc",
  "sha256-uint8array",
  "superbus",
  "superbus-map",
  // tslib?
  "tweetnacl",
];

const baseConfig = {
  bundle: true,
  external: externals,
};

function build(config) {
  esbuild
    .build({
      ...baseConfig,
      ...config,
    })
    .then(() => {
      console.log(`📦 ${config.outfile}`);
    })
    .catch((err) => {
      console.error(`❌  Problem building ${config.outfile}`);
      console.error(err);
      process.exit(1);
    });
}

const configs = [
  // universal, ESM
  {
    entryPoints: ["./src/entries/universal.ts"],
    outfile: "dist/earthstar.js",
    target: ['es2017'],
    format: "esm",
    conditions: ["browser"],
  },
  // universal, commonJS
  {
    entryPoints: ["./src/entries/universal.ts"],
    outfile: "dist/earthstar.cjs",
    target: ['es2017'],
    platform: "node",
    inject: ["./src/shims/node.ts"],
    conditions: ["node"],
  },
  // universal, node, ESM
  {
    entryPoints: ["./src/entries/universal.ts"],
    outfile: "dist/earthstar.mjs",
    target: ['es2017'],
    platform: "node",
    format: "esm",
    inject: ["./src/shims/node.ts"],
    conditions: ["node"],
  },
  // node, CommonJS
  {
    entryPoints: ["./src/entries/node.ts"],
    outfile: "dist/node/node.cjs",
    target: ['es2017'],
    platform: "node",
    conditions: ["node"],
  },
  // node, ESM
  {
    entryPoints: ["./src/entries/node.ts"],
    outfile: "dist/node/node.mjs",
    target: ['es2017'],
    platform: "node",
    format: "esm",
    conditions: ["node"],
  },
  // browser
  {
    entryPoints: ["./src/entries/browser.ts"],
    outfile: "dist/browser/browser.js",
    target: ['es2017'],
    format: "esm",
    conditions: ["browser"],
  },
  // node, legacy
  {
    entryPoints: ["./src/entries/legacy-node.ts"],
    outfile: "dist/node/node-legacy.cjs",
    target: ['es2017'],
    platform: "node",
    conditions: ["node"],
  },
  // Entries for tools which don't support the exports field
  // browser
  {
    entryPoints: ["./src/entries/browser.ts"],
    outfile: "browser/index.js",
    target: ['es2017'],
    format: "esm",
    conditions: ["browser"],
  },
  // node
  {
    entryPoints: ["./src/entries/node.ts"],
    outfile: "node/index.cjs",
    target: ['es2017'],
    platform: "node",
    conditions: ["node"],
  },
];



configs.forEach(build);
