import type { DeckCard } from "@/protocol/deck";

function groupCards(cards: DeckCard[]) {
  const groups = new Map<string, { card: DeckCard; count: number }>();
  for (const card of cards) {
    const group = groups.get(card.identity.name);
    if (group) group.count += 1;
    else groups.set(card.identity.name, { card, count: 1 });
  }
  return [...groups.values()];
}

export function exportToArena(deck: {
  name: string;
  cards: DeckCard[];
  sideboard: DeckCard[];
  maybeboard?: DeckCard[];
  commanders?: DeckCard[];
  attractions?: DeckCard[];
  contraptions?: DeckCard[];
  schemes?: DeckCard[];
  planes?: DeckCard[];
}): string {
  const sections = [
    ["Commander", deck.commanders ?? []],
    ["", deck.cards],
    ["Sideboard", deck.sideboard],
    ["Maybeboard", deck.maybeboard ?? []],
    ["Attractions", deck.attractions ?? []],
    ["Contraptions", deck.contraptions ?? []],
    ["Schemes", deck.schemes ?? []],
    ["Planes", deck.planes ?? []],
  ] as const;
  const lines: string[] = [];
  for (const [label, cards] of sections) {
    if (cards.length === 0) continue;
    if (lines.length > 0) lines.push("");
    if (label) lines.push(label);
    for (const group of groupCards(cards)) {
      lines.push(`${group.count} ${group.card.identity.name}`);
    }
  }
  return lines.join("\n");
}

export function exportWithPrintings(deck: {
  cards: DeckCard[];
  sideboard: DeckCard[];
  maybeboard?: DeckCard[];
  commanders?: DeckCard[];
}): string {
  const sections = [
    ["Commander", deck.commanders ?? []],
    ["Mainboard", deck.cards],
    ["Sideboard", deck.sideboard],
    ["Maybeboard", deck.maybeboard ?? []],
  ] as const;
  const lines: string[] = [];
  for (const [label, cards] of sections) {
    if (cards.length === 0) continue;
    if (lines.length > 0) lines.push("");
    lines.push(label);
    const groups = new Map<string, { card: DeckCard; count: number }>();
    for (const card of cards) {
      const key = `${card.identity.name}::${card.identity.setCode}::${card.identity.cardNumber}::${card.identity.foil ? "foil" : "normal"}`;
      const group = groups.get(key);
      if (group) group.count += 1;
      else groups.set(key, { card, count: 1 });
    }
    for (const { card, count } of groups.values()) {
      lines.push(
        `${count} ${card.identity.name} (${card.identity.setCode.toUpperCase()}) ${card.identity.cardNumber}${card.identity.foil ? " *F*" : ""}`,
      );
    }
  }
  return lines.join("\n");
}
