import type { Deck, DeckCard } from "@/protocol/deck";

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
 * Only the cards actually in the decks are framed. Forge reads its whole
 * cardsfolder at init, so all 33k scripts would cost seconds of boot for cards
 * no game will touch.
 */
export async function buildForgeAssetBundle(decks: Array<Deck | undefined>): Promise<string> {
  const names = [
    ...new Set(
      decks
        .filter((deck): deck is Deck => Boolean(deck))
        .flatMap((deck) => deck.cards ?? [])
        .map((card: DeckCard) => card?.identity?.name)
        .filter((name): name is string => Boolean(name)),
    ),
  ];

  const wasm = await import("@/wasm/wasm");
  await wasm.default();

  const manifest = await (await fetch(CARD_ARCHIVE_MANIFEST, { cache: "no-cache" })).json();
  const response = await fetch(`/wasm/${manifest.archive}`);
  if (!response.ok) throw new Error(`card archive fetch failed: ${response.status}`);

  return wasm.forge_asset_bundle(new Uint8Array(await response.arrayBuffer()), names);
}
