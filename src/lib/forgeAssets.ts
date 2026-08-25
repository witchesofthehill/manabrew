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
        .flatMap((deck) => deckCards(deck))
        .flatMap((card: DeckCard) => {
          const name = card?.identity?.name;
          if (!name) return [];
          // The archive may key a double-faced card either way, and a missing
          // script is silent: Forge substitutes a placeholder that says the
          // card is unsupported, and the game plays on around it.
          const cut = name.indexOf(" // ");
          return cut < 0 ? [name] : [name, name.slice(0, cut)];
        }),
    ),
  ];

  const wasm = await import("@/wasm/wasm");
  await wasm.default();

  const manifest = await (await fetch(CARD_ARCHIVE_MANIFEST, { cache: "no-cache" })).json();
  const response = await fetch(`/wasm/${manifest.archive}`);
  if (!response.ok) throw new Error(`card archive fetch failed: ${response.status}`);

  return wasm.forge_asset_bundle(new Uint8Array(await response.arrayBuffer()), names);
}

/**
 * Every card that can enter the game, not just the main deck: a commander left
 * out of the bundle reaches the command zone as an unsupported placeholder.
 */
function deckCards(deck: Deck): DeckCard[] {
  return [
    ...(deck.cards ?? []),
    ...(deck.commanders ?? []),
    ...(deck.sideboard ?? []),
    ...(deck.attractions ?? []),
    ...(deck.contraptions ?? []),
    ...(deck.schemes ?? []),
    ...(deck.planes ?? []),
    ...(deck.companion ? [deck.companion] : []),
  ];
}
