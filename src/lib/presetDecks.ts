import type { CardPartComponent, Deck, DeckCard, DeckFormat } from "@/protocol/deck";
import type { ScryfallImageUris } from "@/types/scryfall";
import { frontFaceName } from "@/lib/scryfall.utils";

interface PresetDeckCardDefinition {
  name: string;
  count: number;
  set: string;
  cardNumber: string;
  manaCost?: string;
  colors?: string[];
  colorIdentity?: string[];
  cmc?: number;
  types?: string[];
  subtypes?: string[];
  supertypes?: string[];
  text?: string;
  uris: ScryfallImageUris;
  layout?: string;
  power?: string;
  toughness?: string;
  allParts?: Array<{ name: string; component: CardPartComponent }>;
}

export interface PresetDeckDefinition {
  id: string;
  label: string;
  desc: string;
  color: string;
  format?: DeckFormat;
  commander?: string;
  coverCardName?: string;
  cards: PresetDeckCardDefinition[];
}

export function expandPresetDeckDefinition(preset: PresetDeckDefinition): Deck {
  let index = 0;
  const cards: DeckCard[] = [];
  let commander: DeckCard | undefined;

  const presetCommander = preset.commander ? frontFaceName(preset.commander) : undefined;
  for (const entry of preset.cards) {
    const name = frontFaceName(entry.name);
    for (let copy = 0; copy < entry.count; copy += 1) {
      const card: DeckCard = {
        id: `preset:${preset.id}:${index++}:${name}`,
        name,
        setCode: entry.set,
        cardNumber: entry.cardNumber,
        color: entry.colors ? entry.colors.join("") : "",
        colorIdentity: entry.colorIdentity ?? [],
        manaCost: entry.manaCost ?? "",
        cmc: entry.cmc ?? 0,
        types: entry.types ?? [],
        subtypes: entry.subtypes ?? [],
        supertypes: entry.supertypes ?? [],
        power: entry.power,
        toughness: entry.toughness,
        text: entry.text ?? "",
        uris: entry.uris,
        layout: entry.layout,
        allParts: entry.allParts,
      };

      if (!commander && name === presetCommander) {
        commander = card;
      } else {
        cards.push(card);
      }
    }
  }

  // Commander goes in `commanders[]`, not the main 99 — strip it out of cards.
  if (preset.commander && !commander) {
    throw new Error(`Preset commander missing from cards: ${preset.commander}`);
  }

  return {
    id: preset.id,
    name: preset.label,
    description: preset.desc,
    color: preset.color,
    format: preset.format ?? "standard",
    coverCardName: preset.coverCardName ? frontFaceName(preset.coverCardName) : presetCommander,
    cards,
    sideboard: [],
    commanders: commander ? [commander] : undefined,
  };
}

export function expandPresetDeckDefinitions(presets: PresetDeckDefinition[]): Deck[] {
  return presets.map(expandPresetDeckDefinition);
}
