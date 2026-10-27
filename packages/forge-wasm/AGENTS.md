# Forge WASM package

> **Parity is DEPRECATED and NOT FUNCTIONING.** Do not run `yarn parity`, the parity harness (`manabrew-rs/crates/parity`), the parity debugger, or `DeterministicController`. Do not limit or shape a change to keep parity behavior; ignore any instruction here that exists only to keep parity runs passing.

Read `/AGENTS.md` and `/scripts/AGENTS.md` for packaging workflows.

`yarn build:forge-wasm-package --stub-engine` followed by `yarn verify:forge-wasm-package` checks packing, consumer types, and Vite bundling only; never publish a stub build.

Journal/rewind contracts and tests are in `docs/DECISION_REPLAY.md`. Older artifacts ignore `decisionJournal`, so require the initial manifest. Rebuild WebImage after Java transport changes.

The supervisor owns control responses while the leaf event loop is blocked. Keep directive SABs and UI queues across promotion; replace prompt SABs only after verification. Stale prompt responses must return to directive polling. Termination or source failure must stop every child.
