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
  /** 2+ faces of any kind (transform, modal_dfc, split, room, meld, …). */
  isMultiFaced: boolean;
  /** Faces are separate physical sides you flip to view (transform / modal_dfc
   *  / meld / battle / reversible). Split / aftermath / room share one image and
   *  are NOT flippable. */
  isFlippable: boolean;
  /** `[front, back]` for multi-faced cards; `[single]` otherwise; `[]` when the
   *  Scryfall card isn't loaded yet. */
  faces: CardFace[];
}

/**
 * The single source of truth for a card's faces, derived from Scryfall's
 * `card_faces`. Every double-faced consumer (hover preview flip, hand play
 * options, deck editor, battlefield art) resolves faces through here instead of
 * sniffing URLs or per-card flags. Split/room cards report `isFlippable: false`
 * because both halves share one printed image.
 */
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
    // Split/room faces carry no image of their own; both share the top-level one.
    imageUris: f.image_uris ?? info.image_uris,
  }));
  const isFlippable = !isTwoHalfLayout(info.layout) && cardFaces.every((f) => !!f.image_uris);
  return { isMultiFaced: true, isFlippable, faces };
}
