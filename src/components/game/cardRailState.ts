import type { CardDto } from "@/protocol/game";

export type CardRailKind = "saga" | "class";

export interface CardRailNotch {
  id: string;
  label: string;
  position: number;
  active: boolean;
}

export interface CardRailState {
  kind: CardRailKind;
  id: string;
  current: number;
  max: number;
  notches: CardRailNotch[];
}

export const CARD_RAIL_ROOT_DATA_ATTR = "data-card-rail";
export const CARD_RAIL_KIND_DATA_ATTR = "data-card-rail-kind";
export const CARD_RAIL_CURRENT_DATA_ATTR = "data-card-rail-current";
export const CARD_RAIL_MAX_DATA_ATTR = "data-card-rail-max";
export const CARD_RAIL_NOTCH_DATA_ATTR = "data-card-rail-notch";
export const CARD_RAIL_NOTCH_POSITION_DATA_ATTR = "data-card-rail-notch-position";
export const CARD_RAIL_NOTCH_ACTIVE_DATA_ATTR = "data-card-rail-notch-active";

export const CARD_RAIL_ID_PREFIX = "card-rail";
export const CARD_RAIL_NOTCH_ID_PREFIX = "card-rail-notch";

const ROMAN_NUMERALS: Array<[number, string]> = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

const CARD_RAIL_STATE_CACHE = new Map<string, { signature: string; state: CardRailState | null }>();

function toDomSafeId(value: string): string {
  return value.replace(/:/g, "_");
}

function clampPosition(value: number, max: number): number {
  return Math.max(0, Math.min(max, Math.trunc(value)));
}

function toRomanNumeral(value: number): string {
  let remaining = value;
  let result = "";
  for (const [amount, glyph] of ROMAN_NUMERALS) {
    while (remaining >= amount) {
      result += glyph;
      remaining -= amount;
    }
  }
  return result;
}

function getRailId(kind: CardRailKind, cardId: string): string {
  return `${CARD_RAIL_ID_PREFIX}-${kind}-${cardId}`;
}

function getRailInstanceId(railInstanceId: string): string {
  return toDomSafeId(railInstanceId);
}

function getNotchId(railId: string, position: number): string {
  return `${CARD_RAIL_NOTCH_ID_PREFIX}-${railId}-${position}`;
}

function buildNotches(
  railId: string,
  max: number,
  toLabel: (position: number) => string,
): CardRailNotch[] {
  return Array.from({ length: max }, (_, index) => {
    const position = index + 1;
    return {
      id: getNotchId(railId, position),
      label: toLabel(position),
      position,
      active: false,
    };
  });
}

function decorateState(state: CardRailState): CardRailState {
  return {
    ...state,
    notches: state.notches.map((notch) => ({
      ...notch,
      active: state.current === notch.position,
    })),
  };
}

function getCachedRailState(
  cacheKey: string,
  signature: string,
  build: () => CardRailState | null,
): CardRailState | null {
  const cached = CARD_RAIL_STATE_CACHE.get(cacheKey);
  if (cached?.signature === signature) return cached.state;
  const state = build();
  CARD_RAIL_STATE_CACHE.set(cacheKey, { signature, state });
  return state;
}

export function getCardRailRootAttributes(
  state: CardRailState,
  railInstanceId: string,
): Record<string, string> {
  return {
    id: `${state.id}-${getRailInstanceId(railInstanceId)}`,
    [CARD_RAIL_ROOT_DATA_ATTR]: state.kind,
    [CARD_RAIL_KIND_DATA_ATTR]: state.kind,
    [CARD_RAIL_CURRENT_DATA_ATTR]: String(state.current),
    [CARD_RAIL_MAX_DATA_ATTR]: String(state.max),
  };
}

export function getCardRailNotchAttributes(
  notch: CardRailNotch,
  railInstanceId: string,
): Record<string, string> {
  return {
    id: `${notch.id}-${getRailInstanceId(railInstanceId)}`,
    [CARD_RAIL_NOTCH_DATA_ATTR]: String(notch.position),
    [CARD_RAIL_NOTCH_POSITION_DATA_ATTR]: String(notch.position),
    [CARD_RAIL_NOTCH_ACTIVE_DATA_ATTR]: String(notch.active),
  };
}

export function deriveSagaRailState(card: CardDto): CardRailState | null {
  if (!card.subtypes.includes("Saga")) return null;
  const max = card.finalChapter ?? 0;
  if (max <= 0) return null;
  const current = clampPosition(card.counters.Lore ?? 0, max);
  const cacheKey = `${card.id}:saga`;
  const signature = `saga:${current}/${max}`;
  return getCachedRailState(cacheKey, signature, () =>
    decorateState({
      kind: "saga",
      id: getRailId("saga", card.id),
      current,
      max,
      notches: buildNotches(getRailId("saga", card.id), max, toRomanNumeral),
    }),
  );
}

export function deriveClassRailState(card: CardDto): CardRailState | null {
  if (!card.subtypes.includes("Class")) return null;
  const max = 3;
  const current = card.classLevel ?? 0;
  if (current <= 0) return null;
  const clamped = clampPosition(current, max);
  const cacheKey = `${card.id}:class`;
  const signature = `class:${clamped}/${max}`;
  return getCachedRailState(cacheKey, signature, () =>
    decorateState({
      kind: "class",
      id: getRailId("class", card.id),
      current: clamped,
      max,
      notches: buildNotches(getRailId("class", card.id), max, String),
    }),
  );
}

export function deriveCardRailState(card: CardDto): CardRailState | null {
  return deriveSagaRailState(card) ?? deriveClassRailState(card);
}
