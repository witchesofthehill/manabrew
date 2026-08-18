import { useEffect, useMemo, useState } from "react";
import type { Deck, DeckCard } from "@/protocol/deck";
import { deriveTokens } from "@/lib/decks";
import {
  peekAllArchivedTokens,
  prefetchTokenArchive,
  tokenIdentityKey,
} from "@/stores/useScryfallStore";

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
 *  customized entry whose identity matches a derived token takes priority (it
 *  carries the user-chosen print). Customized entries with no derived match
 *  still appear — they'll be pruned on the next card-removal cleanup pass. */
export function mergeDerivedAndCustomized(
  derived: DeckCard[],
  customized: DeckCard[] | undefined,
): DeckCard[] {
  const customByIdentity = new Map((customized ?? []).map((t) => [tokenIdentityKey(t), t]));
  const seen = new Set<string>();
  const out: DeckCard[] = [];
  for (const d of derived) {
    const key = tokenIdentityKey(d);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(customByIdentity.get(key) ?? d);
  }
  for (const c of customized ?? []) {
    const key = tokenIdentityKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
