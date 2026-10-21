import type { ClientCardDto } from "@/stores/gameStore.types";
import { applyDevPreviewMechanicState } from "@/components/dev/devPreviewScenarios";

export type CardRenderingStatus =
  | "tapped"
  | "summoningSick"
  | "exerted"
  | "phasedOut"
  | "isPlotted"
  | "isWarpExiled"
  | "isBestowed"
  | "isCopy"
  | "isFaceDown"
  | "isAttacking"
  | "isCrewed"
  | "isMadnessExiled"
  | "isRingBearer"
  | "wouldDieInCombat";

export type CardRenderingOverrides = Partial<
  Pick<
    ClientCardDto,
    | CardRenderingStatus
    | "types"
    | "supertypes"
    | "subtypes"
    | "keywords"
    | "power"
    | "toughness"
    | "damage"
    | "zoneId"
    | "unlockedDoors"
    | "isSolved"
    | "isSuspended"
    | "isOnAdventure"
    | "isPrototyped"
    | "manaCost"
    | "effectiveManaCost"
    | "color"
  >
> & {
  isToken?: boolean;
  counters?: Record<string, number>;
};

function adjustedStat(stat: string | null, delta: number): string | null {
  if (stat == null || !delta || !Number.isFinite(Number(stat))) return stat;
  return String(Number(stat) + delta);
}

export function applyCardRenderingOverrides(
  card: ClientCardDto,
  overrides: CardRenderingOverrides,
): ClientCardDto {
  if (Object.keys(overrides).length === 0) return applyDevPreviewMechanicState(card);
  const { isToken, counters: counterOverrides, power, toughness, ...fields } = overrides;
  const counters = { ...card.counters };
  for (const [type, count] of Object.entries(counterOverrides ?? {})) {
    if (count > 0) counters[type] = count;
    else delete counters[type];
  }
  const next = applyDevPreviewMechanicState({ ...card, ...fields, counters });
  const types = next.types;
  const counterDelta = types.some((type) => type.toLowerCase() === "creature")
    ? (counters.P1P1 ?? 0) -
      (counters.M1M1 ?? 0) -
      ((card.counters.P1P1 ?? 0) - (card.counters.M1M1 ?? 0))
    : 0;
  return {
    ...next,
    zone:
      fields.zoneId === "battlefield" || fields.zoneId === "hand" || fields.zoneId === "exile"
        ? fields.zoneId
        : fields.zoneId !== undefined
          ? undefined
          : card.zone,
    identity: isToken === undefined ? card.identity : { ...card.identity, isToken },
    counters,
    power: power === undefined ? adjustedStat(card.power, counterDelta) : power,
    toughness: toughness === undefined ? adjustedStat(card.toughness, counterDelta) : toughness,
  };
}
