import esbuild from "esbuild";

const externals = [
  "chalk",
  "fast-deep-equal",
  "rfc4648",
  "rfdc",
  "chloride",
  "sha256-uint8array",
  "tweetnacl",
  "browser-or-node",
  "util"
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
    format: "esm",
    conditions: ["browser"],
  },
  // universal, commonJS
  {
    entryPoints: ["./src/entries/universal.ts"],
    outfile: "dist/earthstar.cjs",
    platform: "node",
    conditions: ["node"],
  },
  // universal, node, ESM
  {
    entryPoints: ["./src/entries/universal.ts"],
    outfile: "dist/earthstar.mjs",
    platform: "node",
    format: "esm",
    conditions: ["node"],
  },
  // node, CommonJS
  {
    entryPoints: ["./src/entries/node.ts"],
    outfile: "dist/node/node.cjs",
    platform: "node",
    conditions: ["node"],
  },
  // node, ESM
  {
    entryPoints: ["./src/entries/node.ts"],
    outfile: "dist/node/node.mjs",
    platform: "node",
    format: "esm",
    conditions: ["node"],
  },
  // browser
  {
    entryPoints: ["./src/entries/browser.js"],
    outfile: "dist/browser/browser.js",
    format: "esm",
    conditions: ["browser"],
  },
];

configs.forEach(build);
