import { useEffect, useMemo, useState } from "react";
import type { Deck, DeckCard } from "@/protocol/deck";
import { deriveTokens } from "@/lib/decks";
import { peekAllArchivedTokens, prefetchTokenArchive } from "@/stores/useScryfallStore";

/** Resolves the derived token list for a deck (one per token name produced by
 *  any card's `allParts`). Waits for the token archive to be loaded so that
 *  `peekArchivedToken` returns results synchronously. */
export function useDerivedTokens(deck: Deck): DeckCard[] {
  const [ready, setReady] = useState(() => peekAllArchivedTokens().length > 0);
  useEffect(() => {
    if (ready) return;
    let cancelled = false;
    void prefetchTokenArchive().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [ready]);
  return useMemo(() => (ready ? deriveTokens(deck) : []), [deck, ready]);
}

/** Merge the derived token list with the deck's customized `tokens[]`. A
 *  customized entry whose name matches a derived token takes priority (it
 *  carries the user-chosen print). Customized entries with no derived match
 *  still appear — they'll be pruned on the next card-removal cleanup pass. */
export function mergeDerivedAndCustomized(
  derived: DeckCard[],
  customized: DeckCard[] | undefined,
): DeckCard[] {
  const customByName = new Map((customized ?? []).map((t) => [t.identity.name.toLowerCase(), t]));
  const seen = new Set<string>();
  const out: DeckCard[] = [];
  for (const d of derived) {
    const key = d.identity.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(customByName.get(key) ?? d);
  }
  for (const c of customized ?? []) {
    const key = c.identity.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
