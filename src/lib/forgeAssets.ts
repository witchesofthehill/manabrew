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
 */
export async function buildForgeAssetBundle(decks: Array<Deck | undefined>): Promise<string> {
  const names = deckCardNames(decks);
  const { wasm, bytes } = await loadCardArchive();
  return wasm.forge_asset_bundle(bytes, names);
}

/** Raw scripts keyed by lowercased card name, for a card the running game reaches for that its bundle left out. */
export async function resolveForgeCardScripts(names: string[]): Promise<Record<string, string>> {
  const { wasm, bytes } = await loadCardArchive();
  const scripts: Record<string, string> = {};
  const fields = wasm.forge_card_scripts(bytes, names).split("\0");
  for (let i = 0; i + 1 < fields.length; i += 2) scripts[fields[i]] = fields[i + 1];
  return scripts;
}

type CardArchive = { wasm: typeof import("@/wasm/wasm"); archive: string; bytes: Uint8Array };

let cardArchive: Promise<CardArchive> | null = null;

/** Kept for the session so a lookup mid-game costs no second fetch; refetched when a deploy renames the archive. */
async function loadCardArchive(): Promise<CardArchive> {
  const manifest = await (await fetch(CARD_ARCHIVE_MANIFEST, { cache: "no-cache" })).json();
  const archive = String(manifest.archive);
  const cached = cardArchive ? await cardArchive.catch(() => null) : null;
  if (cached && cached.archive === archive) return cached;
  cardArchive = (async () => {
    const wasm = await import("@/wasm/wasm");
    await wasm.default();
    const response = await fetch(`/wasm/${archive}`);
    if (!response.ok) throw new Error(`card archive fetch failed: ${response.status}`);
    return { wasm, archive, bytes: new Uint8Array(await response.arrayBuffer()) };
  })();
  return cardArchive;
}
