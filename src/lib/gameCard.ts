import type { CardDto } from "@/protocol/game";
import type { ClientCardDto } from "@/stores/gameStore.types";
import { isTwoFaceLayout, isTwoHalfLayout } from "@/lib/cardLayout";

export const GAME_CARD_DEFAULTS: ClientCardDto = {
  id: "",
  identity: { name: "", setCode: "", cardNumber: "", isToken: false },
  color: "",
  manaCost: "",
  cmc: 0,
  types: [],
  subtypes: [],
  supertypes: [],
  power: null,
  toughness: null,
  classLevels: [],
  sagaChapters: [],
  text: "",
  choices: [],
  controllerId: "",
  ownerId: "",
  zoneId: "",
  tapped: false,
  isCrewed: false,
  isAttacking: false,
  keywords: [],
  grantedKeywords: [],
  counters: {},
  damage: 0,
  summoningSick: false,
  isCopy: false,
  isDoubleFaced: false,
  isTransformed: false,
  isFaceDown: false,
  isBestowed: false,
  phasedOut: false,
  exerted: false,
  isRingBearer: false,
  attachmentIds: [],
  mergedCardIds: [],
  isMadnessExiled: false,
  isPlotted: false,
  isWarpExiled: false,
  foil: false,
  wouldDieInCombat: false,
};

export function gameCardFaceIndex(
  card: Pick<CardDto, "faceIndex" | "isTransformed" | "isDoubleFaced">,
  layout?: string,
): 0 | 1 {
  if (
    isTwoHalfLayout(layout) ||
    layout === "adventure" ||
    layout === "prepare" ||
    layout === "flip"
  )
    return 0;
  if (card.faceIndex !== undefined && (card.isDoubleFaced || isTwoFaceLayout(layout)))
    return card.faceIndex === 1 ? 1 : 0;
  return card.isTransformed ? 1 : 0;
}

export function isFacelessCard(card: Pick<CardDto, "isFaceDown" | "identity">): boolean {
  return card.isFaceDown && !card.identity.name;
}

export function hiddenZoneCard(id: string, ownerId: string, zoneId: string): ClientCardDto {
  return {
    ...GAME_CARD_DEFAULTS,
    id,
    ownerId,
    controllerId: ownerId,
    zoneId,
    isFaceDown: true,
  };
}
