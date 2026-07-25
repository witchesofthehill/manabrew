import type { Deck } from "@/protocol/deck";

export type AiOpponentRef =
  | { kind: "random" }
  | { kind: "preset"; id: string }
  | { kind: "saved"; id: string };

export interface ResolvedAiOpponent {
  id: string;
  deck: Deck;
  source: "preset" | "saved";
}

interface ResolveAiOpponentArgs {
  presets: Deck[];
  savedDecks: { id: string; deck: Deck }[];
  formatId: string;
  last: AiOpponentRef | null;
}

function hasCards(deck: Deck): boolean {
  return deck.cards.length > 0 || (deck.commanders?.length ?? 0) > 0;
}

export function resolveAiOpponent({
  presets,
  savedDecks,
  formatId,
  last,
}: ResolveAiOpponentArgs): ResolvedAiOpponent | null {
  const pool = presets.filter((deck) => (deck.format ?? "standard") === formatId && hasCards(deck));
  if (last?.kind === "preset") {
    const preset = pool.find((deck) => (deck.id ?? deck.name) === last.id);
    if (preset) return { id: preset.id ?? preset.name, deck: preset, source: "preset" };
  }
  if (last?.kind === "saved") {
    const saved = savedDecks.find(
      (entry) =>
        entry.id === last.id &&
        (entry.deck.format ?? "standard") === formatId &&
        hasCards(entry.deck),
    );
    if (saved) return { id: saved.id, deck: saved.deck, source: "saved" };
  }
  const random = pool[Math.floor(Math.random() * pool.length)];
  return random ? { id: random.id ?? random.name, deck: random, source: "preset" } : null;
}
