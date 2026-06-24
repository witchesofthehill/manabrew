import type { DeckCard } from "@/protocol/deck";
import type { ScryfallCard } from "@/types/scryfall";
import { getScryfallManaCost } from "@/api/scryfall";
import { chooseImageUrisForCard } from "@/stores/useScryfallStore";

// ─── Constants ────────────────────────────────────────────────────────────────

export const MTG_SUPERTYPES = new Set(["Basic", "Legendary", "Snow", "World", "Ongoing"]);

// ─── Type Line Parsing ────────────────────────────────────────────────────────

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

// ─── ScryfallCard → DeckCard ─────────────────────────────────────────────────

/** Strip the back face from a DFC name: `"Kazuul's Fury // Kazuul's Cliffs"` → `"Kazuul's Fury"`.
 *  The engine emits only the front-face name (Forge's card DB indexes
 *  DFCs by front face), so `asDeckCard`'s exact-name match needs the
 *  deck side to be the same shape. */
export function frontFaceName(name: string): string {
  const i = name.indexOf(" // ");
  return i >= 0 ? name.slice(0, i) : name;
}

/** Get the front-face type line, handling DFCs where type_line lives on card_faces. */
function getFrontTypeLine(sc: ScryfallCard): string {
  if (sc.type_line) return sc.type_line.split("//")[0].trim();
  return sc.card_faces?.[0]?.type_line ?? "";
}

/** Get the front-face oracle text, handling DFCs. */
function getFrontOracleText(sc: ScryfallCard): string {
  if (sc.oracle_text) return sc.oracle_text;
  return sc.card_faces?.[0]?.oracle_text ?? "";
}

/** True when a Scryfall card has two separate illustrated faces (transform, modal DFC, etc.). */
function detectIsDoubleFaced(sc: ScryfallCard): boolean {
  return !!(sc.card_faces && sc.card_faces.length >= 2 && sc.card_faces[1]?.image_uris);
}

export function scryfallToDeckCard(sc: ScryfallCard): DeckCard {
  const id = sc.id;
  const { supertypes, types, subtypes } = parseTypeLine(getFrontTypeLine(sc));
  const uris = chooseImageUrisForCard(sc, { frontOnly: true });
  if (!uris) throw new Error(`Scryfall card has no image uris: ${sc.name}`);
  return {
    id: id ?? crypto.randomUUID(),
    name: frontFaceName(sc.name),
    setCode: sc.set,
    cardNumber: sc.collector_number,
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
    layout: sc.layout || undefined,
    allParts: sc.all_parts?.map((p) => ({ name: p.name, component: p.component })) ?? [],
  };
}
