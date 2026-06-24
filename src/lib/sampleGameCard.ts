import type { CardDto } from "@/protocol/game";
import type { ScryfallCard } from "@/types/scryfall";
import { GAME_CARD_DEFAULTS } from "@/lib/gameCard";

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
  overrides: Partial<CardDto> = {},
): CardDto {
  const { supertypes, types, subtypes } = parseTypeLine(
    sc.type_line ?? sc.card_faces?.[0]?.type_line ?? "",
  );
  return {
    ...GAME_CARD_DEFAULTS,
    id: sc.id,
    name: sc.name,
    setCode: "",
    cardNumber: "",
    color: (sc.colors ?? []).join(""),
    manaCost: sc.mana_cost ?? sc.card_faces?.[0]?.mana_cost ?? "",
    cmc: sc.cmc,
    types,
    subtypes,
    supertypes,
    keywords: sc.keywords ?? [],
    power: sc.power ?? null,
    toughness: sc.toughness ?? null,
    text: sc.oracle_text ?? "",
    basePower: sc.power != null ? parseInt(sc.power, 10) : undefined,
    baseToughness: sc.toughness != null ? parseInt(sc.toughness, 10) : undefined,
    controllerId: "p1",
    ownerId: "p1",
    zoneId: "battlefield",
    ...overrides,
  };
}
