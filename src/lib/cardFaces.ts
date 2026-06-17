import type { ScryfallCard, ScryfallImageUris } from "@/types/scryfall";
import { isTwoHalfLayout } from "./cardLayout";

export interface CardFace {
  name: string;
  typeLine?: string;
  oracleText?: string;
  manaCost?: string;
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
          imageUris: info.image_uris,
        },
      ],
    };
  }
  const faces: CardFace[] = cardFaces.map((f) => ({
    name: f.name,
    typeLine: f.type_line,
    oracleText: f.oracle_text,
    manaCost: f.mana_cost,
    imageUris: f.image_uris ?? info.image_uris,
  }));
  const isFlippable = !isTwoHalfLayout(info.layout) && cardFaces.every((f) => !!f.image_uris);
  return { isMultiFaced: true, isFlippable, faces };
}
