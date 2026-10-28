import type { ScryfallCard } from "@/types/scryfall";
import type { ClientCardDto } from "@/stores/gameStore.types";
import { GAME_CARD_DEFAULTS } from "@/lib/gameCard";
import { resolveCardFaces } from "@/lib/cardFaces";

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
  overrides: Partial<ClientCardDto> = {},
): ClientCardDto {
  const face = sc.card_faces?.[overrides.faceIndex ?? (overrides.isTransformed ? 1 : 0)] ?? sc;
  const { supertypes, types, subtypes } = parseTypeLine(face.type_line ?? "");
  const colors =
    face.colors ??
    face.color_indicator ??
    (/^Devoid\b/m.test(face.oracle_text ?? "")
      ? []
      : [...new Set(face.mana_cost?.match(/[WUBRG]/g) ?? [])]);
  const keywordLines = (face.oracle_text ?? "")
    .split(/[\n,]/)
    .map((line) => line.trim().toLowerCase());
  const keywords = (sc.keywords ?? []).filter((keyword) =>
    keywordLines.some((line) => line.startsWith(keyword.toLowerCase())),
  );
  const counters = { ...GAME_CARD_DEFAULTS.counters };
  if (face.loyalty && Number.isFinite(Number(face.loyalty)))
    counters.Loyalty = Number(face.loyalty);
  if (face.defense && Number.isFinite(Number(face.defense)))
    counters.Defense = Number(face.defense);
  return {
    ...GAME_CARD_DEFAULTS,
    id: sc.id,
    identity: {
      name: face.name,
      setCode: sc.set,
      cardNumber: sc.collector_number,
      isToken: sc.layout.includes("token"),
    },
    color: colors.join(""),
    manaCost: face.mana_cost ?? "",
    cmc: sc.cmc,
    types,
    subtypes,
    supertypes,
    keywords,
    power: face.power ?? null,
    toughness: face.toughness ?? null,
    text: face.oracle_text ?? "",
    basePower: face.power != null ? parseInt(face.power, 10) : undefined,
    baseToughness: face.toughness != null ? parseInt(face.toughness, 10) : undefined,
    isDoubleFaced: resolveCardFaces(sc).isFlippable,
    counters,
    controllerId: "p1",
    ownerId: "p1",
    zoneId: "battlefield",
    ...overrides,
  };
}
