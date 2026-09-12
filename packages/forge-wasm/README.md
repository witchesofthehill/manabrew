# @manabrew/forge-wasm

Forge compiled to WebAssembly with GraalVM Web Image. The package runs Forge on a worker and exposes its state, display and prompt messages on the main thread.

It runs in a browser and on Node. The entry point differs, the API does not. It includes the Forge launcher and the WebAssembly engine, with Forge's whole asset tree — every card script, token script and edition — embedded inside the engine module at build time. Boot unpacks it into the engine's in-memory filesystem with no JavaScript boundary crossing, and the lazy card index Forge builds from it is complete, so any card can come up in a game.

## Install

Pin an exact version while the API is pre-1.0:

```sh
npm install --save-exact @manabrew/forge-wasm@0.1.0
```

## Browser: server headers

In a browser, Forge uses `SharedArrayBuffer` and requires a cross-origin isolated page. Serve the application with these response headers:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`createForgeEngine()` rejects if `crossOriginIsolated` is false.

## Browser: Vite setup

The package's Vite plugin keeps the large engine module out of dependency pre-bundling and emits it as a static asset:

```js
// vite.config.js
import { forgeWasm } from "@manabrew/forge-wasm/vite";

export default {
  plugins: [forgeWasm()],
};
```

## Node

`import` resolves to a Node entry through the package's `node` condition, with the same API. There is no bundler and no cross-origin isolation to arrange: Node has `SharedArrayBuffer` unconditionally, and the engine runs on a `worker_threads` worker that reads its files from disk.

```js
import { createForgeEngine } from "@manabrew/forge-wasm";

const engine = await createForgeEngine({ onState, onPrompt });
await engine.startGame({ deck, opponentDecks: [deck] });
```

Node 20 or later. Call `dispose()` when the game ends, or the worker thread keeps the process alive.

## Usage

```js
import { createForgeEngine } from "@manabrew/forge-wasm";

const engine = await createForgeEngine({
  onState(state) {
    render(state);
  },
  onPrompt(prompt) {
    showPrompt(prompt, (action) => engine.respond(prompt.id, action));
  },
  onDisplay(event) {
    showEvent(event);
  },
  onError(error) {
    console.error(error);
  },
});

await engine.startGame({
  deck: humanDeck,
  opponentDecks: [computerDeck],
});
```

A deck has `cards` plus optional `commanders`, `sideboard`, `attractions`, `contraptions`, `schemes`, `planes` and `companion`. Each entry can carry its printing under `identity` and is repeated according to `count`:

```js
const deck = {
  format: "commander",
  commanders: [{ identity: { name: "Najeela, the Blade-Blossom" }, count: 1 }],
  cards: [{ identity: { name: "Lightning Bolt", setCode: "M11", cardNumber: "149" }, count: 1 }],
};
```

Pass whole decks, not just the maindeck. Every zone above is read when the game is set up, so a commander or companion left out never reaches the table it belongs to.

Call `dispose()` to terminate the worker. A running Forge game is synchronous inside the worker, so terminating the worker is the only immediate cancellation mechanism.

`directive()` sends an out-of-band instruction such as a concession. The engine can only read it while blocked on that seat, so a directive raised between prompts is held and delivered at the seat's next prompt.

## Types

Messages are typed by [`@manabrew/protocol`](https://www.npmjs.com/package/@manabrew/protocol), which the package depends on: `onState` hands you a `StateUpdate`, `onPrompt` a `Prompt`, `onDisplay` a `DisplayEvent`, and `respond` takes a `PromptOutput`. The range tracks the protocol's major version, which is the wire compatibility boundary.

`ForgeDeck` is looser than the protocol's `Deck`, so a deck can be built from card names alone. A `Deck` satisfies it, so one fetched from a relay can be passed straight to `startGame`.

## Multiplayer seats

`startMultiplayerGame()` creates one SharedArrayBuffer-backed seat per player. Messages for the browser's local seat have no `playerSlot`; remote messages carry `player-0`, `player-1` and so on. Pass that slot back to `respond()` after relaying a remote player's answer.

```js
const engine = await createForgeEngine({
  onMessage(message, playerSlot) {
    if (playerSlot) relayToPlayer(playerSlot, message);
  },
});

await engine.startMultiplayerGame({
  decks,
  playerNames,
  enginePlayerIndex: 0,
});

engine.respond(promptId, action, "player-1");
```

## Asset overrides

The launcher, worker and engine WASM URLs can all be overridden. Their defaults are module-relative URLs that Vite and other modern bundlers emit as static assets. On Node they default to the installed files, and an override may be a path or a `file:` URL.

## Which build is this

The package exports two strings, stamped in when it is built:

```js
import { VERSION, BUILD_COMMIT } from "@manabrew/forge-wasm";
```

`BUILD_COMMIT` names the tree. Quote both in a bug report.

## Subpath exports

One internal is exported because Manabrew's own client imports it rather than keeping a second copy:

- `@manabrew/forge-wasm/seat` — the SharedArrayBuffer seat protocol: `createSeat`, `pollSeat`, `writeSeatMessage`, `deliverSeatDirective` and the signal constants.

## Licence

`@manabrew/forge-wasm` is distributed under the GNU Affero General Public License version 3 or later. Forge itself is GPL-3.0 licensed. Corresponding source is available in the Manabrew repository and its pinned `forge` submodule.
