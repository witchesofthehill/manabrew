# Build & tooling scripts

Helpers used by `yarn` commands and CI. Read first: `/AGENTS.md`.

## What's here

| Script                                              | Purpose                                                                                                                                                                                                                            | Invoke                                         |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `harness.mjs`                                       | Builds the Java harness JAR (`forge-harness-jar-with-dependencies.jar`) and stages the generated Tauri Forge runtime bundle under `src-tauri/resources/forge-runtime/`, including Forge's `cardsfolder/cardsfolder.zip` layout.    | `yarn build:harness`                           |
| `parity.mjs`                                        | Runs a parity test from `regression.json` or custom args.                                                                                                                                                                          | `yarn parity <name>` / `yarn parity:test -- …` |
| `parity-rust-vs-rust.mjs`                           | Rust-only parity (snapshot golden testing without Java).                                                                                                                                                                           | —                                              |
| `parity-classify-entries.mjs`                       | Bucket regression entries by failure mode.                                                                                                                                                                                         | —                                              |
| `parity-repair-agent.py`                            | Automated parity-fix experimentation.                                                                                                                                                                                              | —                                              |
| `build-wasm.mjs`                                    | Builds `forge-wasm`, emits `src/wasm/` bindings, then builds `public/wasm/cardset.v2.rkyv` (cards + tokens + editions in one rkyv blob, same artifact the Tauri shell mmaps). Preset decks ship as-is from `public/preset_decks/`. | —                                              |
| `build-token-archive.mjs`                           | One-off helper for refreshing committed token metadata at `public/token_archive.json`. It is intentionally not wired into normal build scripts.                                                                                     | `node scripts/build-token-archive.mjs`         |
| `generate-theme-css.mjs`                            | Regenerates the `@theme` block in `src/index.css` from `GameThemeColors`. **Run with `--write` after adding a theme key.**                                                                                                         | `node scripts/generate-theme-css.mjs --write`  |
| `import-deck.ts`                                    | Pulls decks from Archidekt/Moxfield, writes a deck JSON into `public/preset_decks/` and refreshes `index.json`.                                                                                                                    | `yarn import-deck …`                           |
| `audit-prompt-contract.mjs`                         | Verifies the engine ↔ UI prompt DTO shape.                                                                                                                                                                                         | —                                              |
| `setup-windows-runner.ps1`, `setup-linux-runner.sh` | One-time CI runner provisioning.                                                                                                                                                                                                   | —                                              |

## Lint and format (yarn)

These are `package.json` scripts (not files in this folder). **Run before every commit** — see the root `/AGENTS.md` "Before every commit" section.

| Command           | What it runs                                                                                | When to use                                   |
| ----------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `yarn lint:all`   | ESLint + Prettier check + `tsc --noEmit` + `cargo fmt --check` + `cargo clippy -D warnings` | Always, before every commit. The full gate.   |
| `yarn fix:all`    | `eslint --fix` + `prettier --write` + `cargo fmt` + `tsc --noEmit`                          | When `lint:all` fails on auto-fixable issues. |
| `yarn format:all` | `prettier --write src` + `cargo fmt --all`                                                  | Formatting only — no lint, no typecheck.      |

Narrower variants also exist (`yarn lint`, `yarn lint:rust`, `yarn format`, `yarn format:check`) for partial runs during iteration. Don't ship a commit that only ran a narrow variant — `lint:all` is the gate.

Never use `--no-verify` to bypass the commit-msg or pre-commit hooks. If a hook fails, fix the cause.

## Conventions

- **New scripts must be runnable via `yarn`.** Add the entry to `package.json`'s `scripts` so CI and humans use the same surface.
- **Don't hardcode absolute paths.** Resolve from the repo root via `process.cwd()` or the script's own location.
- **JDK 18 for harness work.** Set `JAVA_HOME` explicitly (`/Library/Java/JavaVirtualMachines/zulu-18.jdk/Contents/Home` on macOS).
- **Keep stdout machine-readable when CI consumes it.** Status text → stderr; results → stdout.
