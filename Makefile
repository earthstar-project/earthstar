.PHONY: test test-watch npm fmt clean bundle

clean:
	rm -rf npm build .nyc_output coverage earthstar.bundle.js

example:
	deno run --import-map=import_map.json --no-check=remote --config deno.json --allow-env ./src/example-app.ts

test:
	deno test --import-map=import_map.json --no-check=remote --config deno.json src

test-watch:
	deno test --import-map=import_map.json --no-check=remote --config deno.json --watch src

npm:
	deno run --import-map=import_map.json --allow-all scripts/build_npm.ts

fmt:
	deno fmt --options-indent-width=4 src/ scripts/
	
bundle:
	deno bundle --import-map=import_map.json --no-check=remote --config deno.json ./mod.ts ./earthstar.bundle.js