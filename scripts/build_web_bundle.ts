import path from "https://deno.land/std@0.154.0/node/path.ts";
import * as esbuild from "https://deno.land/x/esbuild@v0.15.14/mod.js";
import { denoPlugin } from "https://deno.land/x/esbuild_deno_loader@0.6.0/mod.ts";

const version = Deno.args[0];

const defaultWebCryptoDriverAbsPath = path.resolve(
  "./src/crypto/default_driver.web.ts",
);

const replaceDefaultDriverPlugin: esbuild.Plugin = {
  name: "replaceDefaultDriver",
  setup(build) {
    build.onResolve({ filter: /default\_driver\.ts$/ }, () => {
      return { path: defaultWebCryptoDriverAbsPath };
    });
  },
};

const result = await esbuild.build({
  plugins: [
    replaceDefaultDriverPlugin,
    denoPlugin(),
  ],
  entryPoints: ["./mod.browser.ts"],
  outfile: "./dist/earthstar.web.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  sourcemap: "linked",
  minify: true,
  metafile: true,
  banner: {
    js: `/**
		* Earthstar ${version || ""}
		* https://earthstar-project.org
		*
		* This source code is licensed under the LGPL-3.0 license. 
	*/
	
	`,
  },
});

if (result.metafile) {
  await Deno.writeTextFile(
    "./dist/metafile.json",
    JSON.stringify(result.metafile),
  );
}

Deno.exit(0);
