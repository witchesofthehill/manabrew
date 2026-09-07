import type { ScryfallCard, ScryfallImageUris } from "@/types/scryfall";
import { isTwoHalfLayout } from "./cardLayout";

export interface CardFace {
  name: string;
  typeLine?: string;
  oracleText?: string;
  manaCost?: string;
  flavorText?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  imageUris?: ScryfallImageUris;
}

export interface ResolvedCardFaces {
  isMultiFaced: boolean;
  isFlippable: boolean;
  faces: CardFace[];
}

export function resolveCardFaces(info: ScryfallCard | undefined): ResolvedCardFaces {
  if (!info) return { isMultiFaced: false, isFlippable: false, faces: [] };
  const cardFaces = info.card_faces;
  if (!cardFaces || cardFaces.length < 2) {
    return {
      isMultiFaced: false,
      isFlippable: false,
      faces: [
        {
          name: info.name,
          typeLine: info.type_line,
          oracleText: info.oracle_text,
          manaCost: info.mana_cost,
          flavorText: info.flavor_text,
          power: info.power,
          toughness: info.toughness,
          loyalty: info.loyalty,
          defense: info.defense,
          imageUris: info.image_uris,
        },
      ],
    };
  }
  const faces: CardFace[] = cardFaces.map((f) => ({
    name: f.name,
    typeLine: f.type_line,
    oracleText: f.oracle_text,
    flavorText: f.flavor_text,
    power: f.power,
    toughness: f.toughness,
    loyalty: f.loyalty,
    defense: f.defense,
    manaCost: f.mana_cost,
    imageUris: f.image_uris ?? info.image_uris,
  }));
  const isFlippable = !isTwoHalfLayout(info.layout) && cardFaces.every((f) => !!f.image_uris);
  return { isMultiFaced: true, isFlippable, faces };
}
