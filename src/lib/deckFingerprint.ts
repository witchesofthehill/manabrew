import type { Deck, DeckCard } from "@/protocol/deck";

export async function getDeckEvidenceFingerprint(deck: Deck): Promise<string> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const append = (value: string) => {
    const bytes = encoder.encode(value);
    const length = new Uint8Array(8);
    new DataView(length.buffer).setBigUint64(0, BigInt(bytes.length), true);
    chunks.push(length, bytes);
  };
  const compare = (left: string, right: string) => {
    const leftBytes = encoder.encode(left);
    const rightBytes = encoder.encode(right);
    const length = Math.min(leftBytes.length, rightBytes.length);
    for (let index = 0; index < length; index += 1) {
      if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] - rightBytes[index];
    }
    return leftBytes.length - rightBytes.length;
  };
  const cards: Array<[string, DeckCard]> = [
    ...deck.cards.map((card): [string, DeckCard] => ["main", card]),
    ...deck.sideboard.map((card): [string, DeckCard] => ["sideboard", card]),
    ...(deck.attractions ?? []).map((card): [string, DeckCard] => ["attraction", card]),
    ...(deck.contraptions ?? []).map((card): [string, DeckCard] => ["contraption", card]),
    ...(deck.schemes ?? []).map((card): [string, DeckCard] => ["scheme", card]),
    ...(deck.planes ?? []).map((card): [string, DeckCard] => ["plane", card]),
    ...(deck.commanders ?? []).map((card): [string, DeckCard] => ["commander", card]),
    ...(deck.companion ? [["companion", deck.companion] as [string, DeckCard]] : []),
  ];
  cards.sort((left, right) => {
    for (let index = 0; index < 4; index += 1) {
      const leftValue =
        index === 0
          ? left[0]
          : index === 1
            ? left[1].identity.name
            : index === 2
              ? left[1].identity.setCode
              : left[1].identity.cardNumber;
      const rightValue =
        index === 0
          ? right[0]
          : index === 1
            ? right[1].identity.name
            : index === 2
              ? right[1].identity.setCode
              : right[1].identity.cardNumber;
      const order = compare(leftValue, rightValue);
      if (order !== 0) return order;
    }
    return 0;
  });
  append(deck.name);
  append(deck.format === undefined ? "null" : JSON.stringify(deck.format));
  for (const [section, card] of cards) {
    append(section);
    append(card.identity.name);
    append(card.identity.setCode);
    append(card.identity.cardNumber);
  }
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const input = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    input.set(chunk, offset);
    offset += chunk.length;
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
