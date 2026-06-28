type AnyRecord = Record<string, unknown>;

const CARD_ARRAY_KEYS = [
  "cards",
  "sideboard",
  "attractions",
  "contraptions",
  "schemes",
  "planes",
  "commanders",
  "maybeboard",
  "tokens",
] as const;

function migrateCard(card: AnyRecord): AnyRecord {
  if (card.identity) return card;
  const { id, name, setCode, cardNumber, foil, ...rest } = card;
  return { ...rest, identity: { id, name, setCode, cardNumber, foil } };
}

export function migrate(deck: AnyRecord): AnyRecord {
  const out: AnyRecord = { ...deck };
  for (const key of CARD_ARRAY_KEYS) {
    const arr = deck[key];
    if (Array.isArray(arr)) out[key] = arr.map((c) => migrateCard(c as AnyRecord));
  }
  if (deck.companion) out.companion = migrateCard(deck.companion as AnyRecord);
  return out;
}
