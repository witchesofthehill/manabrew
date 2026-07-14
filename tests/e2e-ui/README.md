# UI e2e tests

Playwright smoke tests for game-UI features that need a real board — the
in-game Board settings modal, the unified card-size multiplier, the zone-pile
lock, and the scry/surveil hover preview. Engine-agnostic (they run on the
default Manabrew engine) and dependency-light, reusing the driving helpers
from `tests/e2e-ironsmith/lib.mjs`.

## Prerequisites

Same stack as `tests/e2e-ironsmith/README.md`, minus the Ironsmith parts:

1. **A relay** on `:9443` with server key `forge`: `yarn dev:relay`
2. **The web client dev server** on `:1420`: `yarn dev:web` (must be the vite
   dev server — the scry test imports a `/src/` module to inject a prompt)
3. **Playwright + Chrome** (`playwright` is a devDependency; system Chrome is
   used via `channel: "chrome"`)

## Run

```bash
cargo xtask e2e-ui                       # the whole suite
node tests/e2e-ui/board-settings.mjs     # one script directly
```

Each script prints `PASS: …` and exits 0, or `FAIL: …` and exits non-zero.

Env knobs: `BASE`, `RELAY_HOST`, `RELAY_PORT`, `RELAY_PW`, `DECK` (as in the
Ironsmith suite), plus `SHOT=<dir>` to write screenshots of the key states.
