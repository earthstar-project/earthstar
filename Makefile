.PHONY: test test-watch npm

clean:
	rm -rf npm build .nyc_output coverage

example:
	deno run --import-map=import_map.json --config deno.json --allow-env ./src/example-app.ts

test:
	deno test --import-map=import_map.json --allow-env --config deno.json src

test-watch:
	deno test --import-map=import_map.json --allow-env --config deno.json --watch src

npm:
	deno run --import-map=import_map.json --allow-all scripts/build_npm.ts

