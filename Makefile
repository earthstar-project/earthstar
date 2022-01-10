.PHONY: test test-watch npm fmt clean bundle

clean:
	rm -rf npm build .nyc_output coverage earthstar.bundle.js cov.lcov coverage_html

example:
	deno run --import-map=import_map.json --no-check=remote --config deno.json --allow-env ./src/example-app.ts

test:
	deno test --import-map=import_map.json --no-check=remote --config deno.json src

test-watch:
	deno test --import-map=import_map.json --no-check=remote --config deno.json --watch src

test-coverage:
	deno test --import-map=import_map.json --no-check=remote --config deno.json --coverage=coverage src

show-coverage:
	deno coverage coverage
# deno coverage --lcov coverage > cov.lcov
# genhtml -o coverage_html cov.lcov

coverage: test-coverage show-coverage

npm:
	deno run --import-map=import_map.json --allow-all scripts/build_npm.ts

fmt:
	deno fmt --options-indent-width=4 src/ scripts/
	
bundle:
	deno bundle --import-map=import_map.json --no-check=remote --config deno.json ./mod.ts ./earthstar.bundle.js

depchart-no-types:
	mkdir -p depchart && npx depchart `find src | grep .ts` --exclude deps.ts src/print-platform-support.ts src/decls.d.ts src/index.ts src/index.browser.ts src/shims/*.ts src/entries/*.ts `find src | grep '/test/'` `find src | grep '/util/'` `find src | grep '/experimental/'` `find src | grep types.ts` --rankdir LR -o depchart/depchart-no-types --node_modules omit

depchart-deps:
	mkdir -p depchart && npx depchart deps.ts `find src | grep .ts` --exclude src/print-platform-support.ts src/decls.d.ts src/index.ts src/index.browser.ts src/shims/*.ts src/entries/*.ts `find src | grep '/test/'` `find src | grep '/util/'` `find src | grep '/experimental/'` --rankdir LR -o depchart/depchart-deps --node_modules separated

depchart: depchart-no-types depchart-deps
