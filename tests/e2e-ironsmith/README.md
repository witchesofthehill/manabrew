# Ironsmith runtime — end-to-end tests

Playwright smoke tests that drive the **real web client against a real relay** to
prove the Ironsmith trusted runtime works end to end: room creation, deck
validation, the host WASM game, per-seat views, the prompt pipeline, bot
integration, and the encrypted two-human relay path.

These are intentionally dependency-light (raw Playwright, no test runner) so they
double as a manual driving harness — the helpers in `lib.mjs` (onboard, connect,
create room, pick deck) are engine-generic and reusable for any multiplayer flow.

## Prerequisites

1. **Ironsmith submodule built + synced** (the runtime wasm):
   ```bash
   git submodule update --init ironsmith
   ./ironsmith/rebuild-wasm.sh          # first run needs the Scryfall sync
   yarn sync:ironsmith
   ```
2. **Feature flag ON.** `ironsmithRuntime` ships `false` (dark). Flip it to `true`
   in `src/featureFlags.ts` for the duration of testing.
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
```

Each prints `PASS: …` and exits 0 on success, or `FAIL: …` and exits non-zero.

### Env knobs

| Var          | Default                 | Meaning                                     |
| ------------ | ----------------------- | ------------------------------------------- |
| `BASE`       | `http://localhost:1420` | web client URL (e.g. `:4173` for preview)   |
| `RELAY_HOST` | `localhost`             | relay host the client is pointed at         |
| `RELAY_PORT` | `9443`                  | relay port                                  |
| `RELAY_PW`   | `forge`                 | relay password / server key                 |
| `DECK`       | `Mono Red Prison`       | preset deck (must be Ironsmith-validatable) |
| `FORMAT`     | `Vintage`               | room format (widens the preset picker)      |
| `SHOT`       | _(off)_                 | dir to write board screenshots into         |
| `HEADED`     | _(off)_                 | `1` to watch in a real browser window       |

## Notes

- **Deck choice matters.** Ironsmith's card support is experimental; many presets
  are rejected at validation (e.g. `Izzet Lessons` → `Gran-Gran` unsupported). The
  `real_*` / simple `starter_deck_*` pools (Mono Red Prison, Workshop, …) fare
  best. A rejection is surfaced to the UI and the game does not start — that path
  is itself worth testing.
- **Unique usernames.** The relay preserves an in-game seat by username; the
  helpers mint a fresh name per run (`uniqueName`) so a reload never rejoins a
  stale game and disables `New Room` / `Start Game`.
- **Desktop.** The Tauri desktop app loads the same web bundle and the same
  `IronsmithTrustedGameApi`, so this web coverage applies to desktop too; a native
  bundle additionally needs the `forge` submodule + harness build.
