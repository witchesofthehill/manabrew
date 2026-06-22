import type { GameCard } from "@/types/manabrew";
import type { ScryfallCard } from "@/types/scryfall";

const SUPERTYPES = new Set(["Legendary", "Basic", "Snow", "World", "Ongoing", "Token"]);

function parseTypeLine(line: string) {
  const [left, right] = (line ?? "").split("—").map((s) => s.trim());
  const words = (left ?? "").split(/\s+/).filter(Boolean);
  const supertypes = words.filter((w) => SUPERTYPES.has(w));
  const types = words.filter((w) => !SUPERTYPES.has(w));
  const subtypes = (right ?? "").split(/\s+/).filter(Boolean);
  return { supertypes, types, subtypes };
}

// Not for live game state — defaults are static.
export function scryfallToSampleGameCard(
  sc: ScryfallCard,
  overrides: Partial<GameCard> = {},
): GameCard {
  const { supertypes, types, subtypes } = parseTypeLine(
    sc.type_line ?? sc.card_faces?.[0]?.type_line ?? "",
  );
  return {
    id: sc.id,
    name: sc.name,
    setCode: "",
    cardNumber: "",
    color: (sc.colors ?? []).join(""),
    colorIdentity: sc.color_identity ?? [],
    manaCost: sc.mana_cost ?? sc.card_faces?.[0]?.mana_cost ?? "",
    cmc: sc.cmc,
    types,
    subtypes,
    supertypes,
    keywords: sc.keywords ?? [],
    power: sc.power,
    toughness: sc.toughness,
    text: sc.oracle_text ?? "",
    layout: sc.layout,
    basePower: sc.power != null ? parseInt(sc.power, 10) : undefined,
    baseToughness: sc.toughness != null ? parseInt(sc.toughness, 10) : undefined,
    isPlayable: true,
    controllerId: "p1",
    ownerId: "p1",
    zoneId: "battlefield",
    ...overrides,
  };
}
