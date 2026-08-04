import type {
  CardBackFaceSummary,
  CardPartComponent,
  Deck,
  DeckCard,
  DeckFormat,
} from "@/protocol/deck";
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
  backFace?: CardBackFaceSummary;
  allParts?: Array<{ name: string; component: CardPartComponent }>;
}

export interface PresetDeckDefinition {
  id: string;
  label: string;
  desc: string;
  color: string;
  format?: DeckFormat | "historicBrawl";
  commander?: string;
  coverCardName?: string;
  cards: PresetDeckCardDefinition[];
  sideboard?: PresetDeckCardDefinition[];
}

export async function loadPresetDeckDefinitions(
  indexUrl = "/preset_decks/index.json",
  deckBaseUrl = "/preset_decks",
): Promise<PresetDeckDefinition[]> {
  const indexResponse = await fetch(indexUrl);
  if (!indexResponse.ok) {
    throw new Error(`Failed to fetch preset deck index: ${indexResponse.status}`);
  }
  const ids = (await indexResponse.json()) as string[];
  const results = await Promise.all(
    ids.map(async (id) => {
      const response = await fetch(`${deckBaseUrl}/${id}.json`);
      if (!response.ok) {
        console.warn(`[PresetDecks] Preset deck '${id}' failed (${response.status})`);
        return null;
      }
      const data = (await response.json()) as Omit<PresetDeckDefinition, "id">;
      return { id, ...data };
    }),
  );
  return results.filter((deck): deck is PresetDeckDefinition => deck !== null);
}

export function expandPresetDeckDefinition(preset: PresetDeckDefinition): Deck {
  let index = 0;
  const cards: DeckCard[] = [];
  const sideboard: DeckCard[] = [];
  let commander: DeckCard | undefined;

  const presetCommander = preset.commander ? frontFaceName(preset.commander) : undefined;
  const appendCards = (
    entries: PresetDeckCardDefinition[],
    destination: DeckCard[],
    extractCommander = false,
  ) => {
    for (const entry of entries) {
      const name = frontFaceName(entry.name);
      for (let copy = 0; copy < entry.count; copy += 1) {
        const card: DeckCard = {
          identity: {
            id: `preset:${preset.id}:${index++}:${name}`,
            name,
            setCode: entry.set,
            cardNumber: entry.cardNumber,
            foil: false,
          },
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
          backFace: entry.backFace,
          allParts: entry.allParts,
        };

        if (extractCommander && !commander && name === presetCommander) {
          commander = card;
        } else {
          destination.push(card);
        }
      }
    }
  };
  appendCards(preset.cards, cards, true);
  appendCards(preset.sideboard ?? [], sideboard);

  // Commander goes in `commanders[]`, not the main 99 — strip it out of cards.
  if (preset.commander && !commander) {
    throw new Error(`Preset commander missing from cards: ${preset.commander}`);
  }

  return {
    id: preset.id,
    name: preset.label,
    description: preset.desc,
    color: preset.color,
    format: preset.format === "historicBrawl" ? "brawl" : (preset.format ?? "standard"),
    coverCardName: preset.coverCardName ? frontFaceName(preset.coverCardName) : presetCommander,
    cards,
    sideboard,
    commanders: commander ? [commander] : undefined,
  };
}

export function expandPresetDeckDefinitions(presets: PresetDeckDefinition[]): Deck[] {
  return presets.map(expandPresetDeckDefinition);
}
