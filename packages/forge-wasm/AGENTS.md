# Forge WASM package

Read `/AGENTS.md` and `/scripts/AGENTS.md` for packaging workflows.

`yarn build:forge-wasm-package --stub-engine` followed by `yarn verify:forge-wasm-package` checks packing, consumer types, and Vite bundling only; never publish a stub build.

`decisionJournal: true` makes an ordinary engine emit `forge:journal` batches, the hidden consumed-input stream shared with JVM and native (see the harness AGENTS file). Older artifacts ignore the option, so require the initial manifest.
