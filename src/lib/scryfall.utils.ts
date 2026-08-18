import type { CardBackFaceSummary, DeckCard } from "@/protocol/deck";
import type { CardDto } from "@/protocol/game";
import type { ScryfallCard } from "@/types/scryfall";
import { getScryfallManaCost } from "@/api/scryfall";
import { chooseImageUrisForCard } from "@/stores/useScryfallStore";

export const MTG_SUPERTYPES = new Set(["Basic", "Legendary", "Snow", "World", "Ongoing"]);

export interface ParsedTypeLine {
  supertypes: string[];
  types: string[];
  subtypes: string[];
}

export function parseTypeLine(typeLine: string): ParsedTypeLine {
  const [mainPart = "", subPart = ""] = typeLine.split("—").map((s) => s.trim());
  const mainTokens = mainPart.split(/\s+/).filter(Boolean);
  return {
    supertypes: mainTokens.filter((t) => MTG_SUPERTYPES.has(t)),
    types: mainTokens.filter((t) => !MTG_SUPERTYPES.has(t)),
    subtypes: subPart ? subPart.split(/\s+/).filter(Boolean) : [],
  };
}

/** Strip the back face from a DFC name: `"Kazuul's Fury // Kazuul's Cliffs"` → `"Kazuul's Fury"`.
 *  The engine emits only the front-face name (Forge's card DB indexes
 *  DFCs by front face), so `asDeckCard`'s exact-name match needs the
 *  deck side to be the same shape. */
export function frontFaceName(name: string): string {
  const i = name.indexOf(" // ");
  return i >= 0 ? name.slice(0, i) : name;
}

function getFrontTypeLine(sc: ScryfallCard): string {
  if (sc.type_line) return sc.type_line.split("//")[0].trim();
  return sc.card_faces?.[0]?.type_line ?? "";
}

function getFrontOracleText(sc: ScryfallCard): string {
  if (sc.oracle_text) return sc.oracle_text;
  return sc.card_faces?.[0]?.oracle_text ?? "";
}

function detectIsDoubleFaced(sc: ScryfallCard): boolean {
  return !!(sc.card_faces && sc.card_faces.length >= 2 && sc.card_faces[1]?.image_uris);
}

// Same two-image gate as detectIsDoubleFaced: split/adventure/flip/room share
// one image and return undefined.
function buildBackFaceSummary(sc: ScryfallCard): CardBackFaceSummary | undefined {
  const back = sc.card_faces?.[1];
  const img = back?.image_uris;
  if (!back || !img) return undefined;
  return {
    name: back.name,
    manaCost: back.mana_cost ?? "",
    typeLine: back.type_line ?? "",
    oracleText: back.oracle_text ?? "",
    uris: {
      small: img.small,
      normal: img.normal,
      large: img.large,
      png: img.png,
      art_crop: img.art_crop,
      border_crop: img.border_crop,
    },
  };
}

export function needsScryfallEnrichment(card: DeckCard): boolean {
  const needsBasicMeta = (card.cmc === undefined || card.cmc === null) && !card.manaCost;
  const needsAllParts = card.allParts === undefined;
  const needsBackFace =
    (card.isDoubleFaced === true || card.layout === "transform" || card.layout === "modal_dfc") &&
    card.backFace === undefined;
  return needsBasicMeta || needsAllParts || needsBackFace;
}

export function scryfallToDeckCard(sc: ScryfallCard): DeckCard {
  const id = sc.id;
  const { supertypes, types, subtypes } = parseTypeLine(getFrontTypeLine(sc));
  const uris = chooseImageUrisForCard(sc, { frontOnly: true });
  if (!uris) throw new Error(`Scryfall card has no image uris: ${sc.name}`);
  return {
    identity: {
      id: id ?? crypto.randomUUID(),
      name: frontFaceName(sc.name),
      setCode: sc.set,
      cardNumber: sc.collector_number,
      oracleId: sc.oracle_id,
    },
    color: sc.colors ? sc.colors.join("") : "",
    colorIdentity: sc.color_identity ?? [],
    manaCost: getScryfallManaCost(sc) ?? "",
    cmc: sc.cmc,
    types,
    subtypes,
    supertypes,
    power: sc.power,
    toughness: sc.toughness,
    text: getFrontOracleText(sc),
    uris,
    isDoubleFaced: detectIsDoubleFaced(sc) || undefined,
    backFace: buildBackFaceSummary(sc),
    layout: sc.layout || undefined,
    allParts: sc.all_parts?.map((p) => ({ name: p.name, component: p.component })) ?? [],
  };
}

const previewDtoByDeckCard = new WeakMap<DeckCard, CardDto>();

export function deckCardToPreviewDto(card: DeckCard): CardDto {
  const cached = previewDtoByDeckCard.get(card);
  if (cached) return cached;
  const preview = { ...card, foil: card.identity.foil ?? false } as unknown as CardDto;
  previewDtoByDeckCard.set(card, preview);
  return preview;
}
