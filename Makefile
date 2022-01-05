.PHONY: test test-watch npm

test:
	deno test --import-map=import_map.json --allow-env --config deno.json src
  
test-watch:
	deno test --import-map=import_map.json --allow-env --config deno.json --watch src
  
npm:
	deno run --import-map=import_map.json --allow-all scripts/build_npm.ts
  
