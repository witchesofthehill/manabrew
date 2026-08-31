import type { Deck } from "@/protocol/deck";
import { deckCardNames } from "@forge-wasm/deckCards.js";

const CARD_ARCHIVE_MANIFEST = "/wasm/cardset.manifest.json";

/**
 * Frames Forge's asset tree out of cardset.rkyv — the same archive the Rust
 * engine uses and the client already caches, so nothing is shipped twice.
 *
 * This lives on the main thread rather than in the Forge worker because the
 * worker is plain JS served from public/ and cannot resolve a bundled module:
 * a hardcoded `/src/wasm/wasm.js` works against the dev server and 404s to
 * index.html in a build.
 *
 * Which names go in is `deckCardNames`, shared with the published
 * `@manabrew/forge-wasm` package so the two selectors cannot drift.
 */
export async function buildForgeAssetBundle(decks: Array<Deck | undefined>): Promise<string> {
  const names = deckCardNames(decks);

  const wasm = await import("@/wasm/wasm");
  await wasm.default();

  const manifest = await (await fetch(CARD_ARCHIVE_MANIFEST, { cache: "no-cache" })).json();
  const response = await fetch(`/wasm/${manifest.archive}`);
  if (!response.ok) throw new Error(`card archive fetch failed: ${response.status}`);

  return wasm.forge_asset_bundle(new Uint8Array(await response.arrayBuffer()), names);
}
