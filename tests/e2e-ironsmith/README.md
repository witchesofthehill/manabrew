# Ironsmith runtime — end-to-end tests

> **Parity is DEPRECATED and NOT FUNCTIONING.** Do not run `yarn parity`, the parity harness (`manabrew-rs/crates/parity`), the parity debugger, or `DeterministicController`. Do not limit or shape a change to keep parity behavior; ignore any instruction here that exists only to keep parity runs passing.

Playwright smoke tests that drive the **real web client against a real relay** to
prove the Ironsmith trusted runtime works end to end: room creation, deck
validation, the host WASM game, per-seat views, the prompt pipeline, bot
integration, and the encrypted two-human relay path.

These are intentionally dependency-light (raw Playwright, no test runner) so they
double as a manual driving harness — the helpers in `lib.mjs` (onboard, connect,
create room, pick deck) are engine-generic and reusable for any multiplayer flow.

## Prerequisites

1. **Ironsmith wasm installed.** It ships as the `ironsmith-wasm` npm dependency,
   so a plain `yarn install` pulls it — no submodule or local wasm build.
2. **The engine opt-in.** The `ironsmithRuntime` compile flag is on, but the
   engine is opt-in per browser (Settings → Preferences → _Ironsmith engine
   (experimental)_, the `ironsmithRuntimeEnabled` preference). Each test runs in
   a fresh browser context, so the helpers turn it on themselves
   (`enableIronsmith` in `lib.mjs`) for every seat — a guest without it is
   dropped back to the lobby when the game starts.
3. **A relay** on `:9443` with server key `forge`:
   ```bash
   yarn dev:relay              # or: MANABREW_SERVER_KEY=forge cargo run --release -p manabrew-server
   ```
4. **The web client** on `:1420`:
   ```bash
   yarn dev:web
   ```
5. **Playwright + Chrome.** `playwright` is a devDependency; the tests use the
   system Google Chrome (`channel: "chrome"`) so there's no Chromium download.

> The client defaults to the **production** relay (`relay.manabrew.app`). The
> tests always repoint it at the local relay via Settings first — never run an
> Ironsmith test against production.

## Run

```bash
# Single client + bot: game reaches a live board (mulligan → priority).
node tests/e2e-ironsmith/ironsmith-multiplayer.mjs

# Two humans: exercises the encrypted per-seat relay (ECDH + AES-GCM).
node tests/e2e-ironsmith/ironsmith-two-clients.mjs

# Host migration: the host's browser goes away mid-game and the guest hosts on.
# Dev server only (it reads the game through `window.__gameStore`); takes about
# two minutes, because it waits out the absent seat's reconnect window.
node tests/e2e-ironsmith/ironsmith-host-migration.mjs
```

Each prints `PASS: …` and exits 0 on success, or `FAIL: …` and exits non-zero.

## How an Ironsmith game is shared

Every seat runs its own copy of the Ironsmith engine. The host only orders the
inputs (prompt answers and directives) into a transcript; each seat applies it
to its own engine and draws its own view, and a fingerprint of the public state
on every entry lets a seat notice it has diverged and rebuild from the host's
transcript. Because no seat depends on the host's engine, the relay hands the
host role to the next connected human seat when the host's seat is lost
(`engine_survives_host_loss` / `migrate_host` in `manabrew-server`), the room
update names the new host, and the game carries on. The lost seat forfeits when
its reconnect window (the table's reconnect timeout) runs out, like any other
seat.

### Env knobs

| Var          | Default                 | Meaning                                     |
| ------------ | ----------------------- | ------------------------------------------- |
| `BASE`       | `http://localhost:1420` | web client URL (e.g. `:4173` for preview)   |
| `RELAY_HOST` | `localhost`             | relay host the client is pointed at         |
| `RELAY_PORT` | `9443`                  | relay port                                  |
| `RELAY_PW`   | `forge`                 | relay password / server key                 |
| `DECK`       | `Goblins`               | preset deck (must be offered for Ironsmith) |
| `FORMAT`     | `Vintage`               | room format (widens the preset picker)      |
| `SHOT`       | _(off)_                 | dir to write board screenshots into         |
| `HEADED`     | _(off)_                 | `1` to watch in a real browser window       |

## Notes

- **Deck choice matters.** Presets are per-engine: an Ironsmith table's picker
  only lists presets that declare `engines: ["Ironsmith"]` and are legal in the
  room's format (in Vintage that is currently `Goblins — Steven Paris`). `DECK`
  is matched as a partial, case-insensitive name against that list.
- **Prompt check needs the dev server.** Prompts are drawn on the board canvas,
  so the tests read the prompt from `window.__gameStore`, which only the Vite
  dev server exposes. Against a preview build they assert the board alone.
- **Unique usernames.** The relay preserves an in-game seat by username; the
  helpers mint a fresh name per run (`uniqueName`) so a reload never rejoins a
  stale game and disables `New Room` / `Start Game`.
- **Desktop.** The Tauri desktop app loads the same web bundle and the same
  `IronsmithTrustedGameApi`, so this web coverage applies to desktop too; a native
  bundle additionally needs the `forge` submodule + harness build.
