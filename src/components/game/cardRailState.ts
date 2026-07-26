import type { CardDto } from "@/protocol/game";

export type CardRailKind = "saga" | "class";

export interface CardRailNotch {
  id: string;
  label: string;
  position: number;
  reached: boolean;
  active: boolean;
}

export interface CardRailEffect {
  position: number;
  text: string;
  label?: string;
  cost?: string;
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
export const CARD_RAIL_NOTCH_REACHED_DATA_ATTR = "data-card-rail-notch-reached";
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
      reached: false,
      active: false,
    };
  });
}

function decorateState(state: CardRailState): CardRailState {
  return {
    ...state,
    notches: state.notches.map((notch) => ({
      ...notch,
      reached: notch.position <= state.current,
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
    [CARD_RAIL_NOTCH_REACHED_DATA_ATTR]: String(notch.reached),
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

function appendEffect(effects: Map<number, CardRailEffect>, position: number, text: string): void {
  const previous = effects.get(position);
  effects.set(position, {
    position,
    text: previous?.text ? `${previous.text}\n${text}` : text,
    cost: previous?.cost,
  });
}

function isChapterAnnotation(text: string): boolean {
  if (/^Choose one(?: at random)?$/i.test(text)) return true;
  const words = text.split(/\s+/);
  return (
    words.length <= 6 &&
    !text.includes('"') &&
    words.every(
      (word, index) =>
        index === 0 || /^(?:a|an|and|of|the|to)$/i.test(word) || /^[A-Z0-9]/.test(word),
    )
  );
}

export function parseCardRailEffects(
  state: CardRailState,
  oracleText: string | undefined,
): CardRailEffect[] {
  if (!oracleText) return [];
  const lines = oracleText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const effects = new Map<number, CardRailEffect>();

  if (state.kind === "saga") {
    let currentPositions: number[] = [];
    for (const line of lines) {
      const chapter = line.match(/^([IVXLCDM]+(?:,\s*[IVXLCDM]+)*)\s+[\u2013\u2014-]\s+(.+)$/);
      if (chapter) {
        currentPositions = chapter[1]
          .split(",")
          .map((label) => state.notches.find((notch) => notch.label === label.trim())?.position)
          .filter((position): position is number => position != null);
        const annotation = chapter[2].match(/^(.+?)\s+[\u2013\u2014-]\s+(.+)$/);
        const label =
          annotation?.[1] && isChapterAnnotation(annotation[1]) ? annotation[1] : undefined;
        for (const position of currentPositions) {
          effects.set(position, {
            position,
            label,
            text: label ? (annotation?.[2] ?? chapter[2]) : chapter[2],
          });
        }
      } else if (line.startsWith("•")) {
        for (const position of currentPositions) {
          appendEffect(effects, position, line);
        }
      }
    }
  } else {
    let position = 1;
    for (const line of lines) {
      const level = line.match(/^(.*?):\s*Level\s+(\d+)$/i);
      if (level) {
        position = clampPosition(Number(level[2]), state.max);
        effects.set(position, { position, text: "", cost: level[1].trim() });
      } else if (!line.startsWith("(")) {
        appendEffect(effects, position, line);
      }
    }
  }

  return state.notches.flatMap((notch) => {
    const effect = effects.get(notch.position);
    return effect ? [effect] : [];
  });
}
