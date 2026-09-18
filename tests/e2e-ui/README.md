# UI e2e tests

Playwright smoke tests for game-UI features that need a real board — the
in-game Board settings modal, the unified card-size multiplier and the
zone-pile lock. Engine-agnostic (they run on the default Manabrew engine) and
dependency-light, reusing the driving helpers from `tests/e2e-ironsmith/lib.mjs`.

Prompts are drawn on the canvas, so a script answers them through the dev-only
`window.__gameStore` seam rather than by clicking; `forgeSolo.mjs` holds the
shared start sequence and a least-committal answer for every prompt type.

## Prerequisites

Same stack as `tests/e2e-ironsmith/README.md`, minus the Ironsmith parts:

1. **A relay** on `:9443` with server key `forge`: `yarn dev:relay`
2. **The web client dev server** on `:1420`: `yarn dev:web` (must be the vite
   dev server — the scripts answer prompts through `window.__gameStore`)
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

## The browser Forge engine

`forge-wasm-*.mjs` drive Forge compiled to WebAssembly, the offline engine.
They **assert which engine answered** — `window.__engineDecisions`
exists only on the Forge path — because a script that merely asks for an engine
and measures whatever runs is how the first round of latency numbers came from
the wrong one.

| script                               | what it holds down                                                       |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `forge-wasm-offline`                 | a game is playable, and no card came back unsupported                    |
| `forge-wasm-commander`               | commander rules apply: 40 life, commanders in the command zone           |
| `forge-wasm-limited`                 | Limited still works with the engine on (it is served by the Rust worker) |
| `forge-wasm-rematch`                 | a second game starts after walking out of the first                      |
| `forge-wasm-table`                   | `SEATS=2..4` humans over a real relay, hosted in the browser             |
| `forge-wasm-autopass`                | dead windows pass themselves, and a held pass is honoured                |
| `forge-wasm-telemetry`               | a finished game reports its timings, carrying nothing about the deck     |
| `forge-wasm-latency` / `-activation` | measurement, not assertions: turnaround by action type                   |

The offline page runs Forge; the `ENGINE=forge|rust` knob predates that and
only changes what the scripts assert.

Two of them read `window.__gameStore`, which a **production build strips**, so
against a deployed `BASE` they fall back to the frame stream and the board's own
text. A script that reads only the store reports an empty board against staging
and looks exactly like an engine hang.
