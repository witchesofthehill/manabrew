# @manabrew/forge-wasm

Forge compiled to WebAssembly with GraalVM Web Image. The package runs Forge in a classic Web Worker and exposes its state, display and prompt messages on the main thread.

The package is browser-only. It includes the Forge launcher, the WebAssembly engine and a static `cardset.rkyv` archive. Card scripts for the decks in play are selected from the archive before Forge boots, so the Java boundary only receives the files needed by that game.

## Install

Pin an exact version while the API is pre-1.0:

```sh
npm install --save-exact @manabrew/forge-wasm@0.1.0
```

## Server headers

Forge uses `SharedArrayBuffer` and requires a cross-origin isolated page. Serve the application with these response headers:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`createForgeEngine()` rejects if `crossOriginIsolated` is false.

## Vite setup

The package's Vite plugin keeps the large engine and cardset out of dependency pre-bundling and emits them as static assets:

```js
// vite.config.js
import { forgeWasm } from "@manabrew/forge-wasm/vite";

export default {
  plugins: [forgeWasm()],
};
```

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

Pass whole decks, not just the maindeck. Every zone above is read when the card scripts are chosen, and a card left out arrives at the table as an unsupported placeholder rather than an error: the game plays on around it.

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

## Cardset and asset overrides

The default cardset is exported as `@manabrew/forge-wasm/cardset.rkyv`. To serve the same immutable archive from a CDN or another static-file pipeline, pass its URL:

```js
await createForgeEngine({
  cardsetUrl: "https://static.example/cardset.rkyv",
});
```

A host which already has the Manabrew cardset pipeline can avoid loading the packaged archive by supplying a framed asset string. The framing is `path\0body\0…` and paths are relative to Forge's resource root.

```js
await createForgeEngine({
  assets: async (decks) => buildExistingForgeAssetBundle(decks),
});
```

The launcher, worker, engine WASM, asset-selector WASM and cardset URLs can all be overridden. Their defaults are module-relative URLs that Vite and other modern bundlers emit as static assets.

## Which build is this

The package exports three strings, stamped in when it is built:

```js
import { VERSION, CARDSET_ARCHIVE_VERSION, BUILD_COMMIT } from "@manabrew/forge-wasm";
```

`CARDSET_ARCHIVE_VERSION` is the `forge-cardset-archive` release whose card-script selector is compiled in. It releases on its own cadence, so it names a crate a Rust consumer can install to get the same selection rules, and it is the last released version rather than the exact source. `BUILD_COMMIT` names the tree. Quote all three in a bug report.

## Subpath exports

Two internals are exported because a host that overrides `assets` still needs them, and because Manabrew's own client imports them rather than keeping a second copy:

- `@manabrew/forge-wasm/deckCards` — `deckCardNames(decks)`, the names to ask the archive selector for.
- `@manabrew/forge-wasm/seat` — the SharedArrayBuffer seat protocol: `createSeat`, `pollSeat`, `writeSeatMessage`, `deliverSeatDirective` and the signal constants.

## Licence

`@manabrew/forge-wasm` is distributed under the GNU Affero General Public License version 3 or later. Forge itself is GPL-3.0 licensed. Corresponding source is available in the Manabrew repository and its pinned `forge` submodule.
