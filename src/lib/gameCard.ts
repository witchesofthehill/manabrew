import type { CardDto } from "@/protocol/game";
import type { ClientCardDto } from "@/stores/gameStore.types";

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
