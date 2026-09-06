import type { CardDto, ClassLevelDto, SagaChapterDto } from "@/protocol/game";

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
export type PrintedCardRailMetadata =
  | { kind: "saga"; finalChapter: number; sagaChapters: SagaChapterDto[] }
  | { kind: "class"; classLevels: ClassLevelDto[] };

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
function fromRomanNumeral(value: string): number | null {
  let total = 0;
  let previous = 0;
  for (const character of [...value].reverse()) {
    const current =
      character === "I"
        ? 1
        : character === "V"
          ? 5
          : character === "X"
            ? 10
            : character === "L"
              ? 50
              : character === "C"
                ? 100
                : character === "D"
                  ? 500
                  : character === "M"
                    ? 1000
                    : 0;
    if (current === 0) return null;
    if (current < previous) total -= current;
    else {
      total += current;
      previous = current;
    }
  }
  return total > 0 ? total : null;
}

function appendLine(value: string, line: string): string {
  return value ? `${value}\n${line}` : line;
}

export function parsePrintedCardRailMetadata(card: {
  subtypes: string[];
  text: string;
}): PrintedCardRailMetadata | null {
  const lines = card.text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (card.subtypes.includes("Saga")) {
    const sagaChapters: SagaChapterDto[] = [];
    let currentChapter: SagaChapterDto | null = null;
    for (const line of lines) {
      let heading: SagaChapterDto | null = null;
      for (const separator of [" — ", " – ", " - "]) {
        const separatorIndex = line.indexOf(separator);
        if (separatorIndex < 0) continue;
        const chapters = line
          .slice(0, separatorIndex)
          .split(",")
          .map((label) => fromRomanNumeral(label.trim()));
        if (chapters.some((chapter) => chapter == null)) continue;
        heading = {
          chapters: chapters as number[],
          oracle: line.slice(separatorIndex + separator.length),
        };
        break;
      }
      if (heading) {
        sagaChapters.push(heading);
        currentChapter = heading;
      } else if (line.startsWith("•") && currentChapter) {
        currentChapter.oracle = appendLine(currentChapter.oracle, line);
      }
    }
    const finalChapter = Math.max(0, ...sagaChapters.flatMap((chapter) => chapter.chapters));
    return finalChapter > 0 ? { kind: "saga", finalChapter, sagaChapters } : null;
  }

  if (card.subtypes.includes("Class")) {
    const classLevels: ClassLevelDto[] = [{ level: 1, oracle: "" }];
    let currentLevel = classLevels[0]!;
    for (const line of lines) {
      if (line.startsWith("(") && classLevels.length === 1 && !currentLevel.oracle) continue;
      const heading = line.match(/^(.*): Level (\d+)$/);
      if (heading) {
        currentLevel = {
          level: Number.parseInt(heading[2]!, 10),
          oracle: "",
          cost: heading[1]!.trim(),
        };
        classLevels.push(currentLevel);
      } else {
        currentLevel.oracle = appendLine(currentLevel.oracle, line);
      }
    }
    if (classLevels.every((level) => !level.oracle)) return null;
    classLevels.sort((left, right) => left.level - right.level);
    return { kind: "class", classLevels };
  }

  return null;
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
  const max = Math.max(
    card.finalChapter ?? 0,
    ...(card.sagaChapters ?? []).flatMap((chapter) => chapter.chapters),
  );
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
  const max = Math.max(0, ...(card.classLevels ?? []).map((level) => level.level));
  const current = card.classLevel ?? 0;
  if (current <= 0 || max <= 0) return null;
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

function appendEffect(
  effects: Map<number, CardRailEffect>,
  position: number,
  text: string,
  cost?: string,
): void {
  const previous = effects.get(position);
  effects.set(position, {
    position,
    text: previous?.text ? `${previous.text}\n${text}` : text,
    cost: cost ?? previous?.cost,
  });
}

export function deriveCardRailEffects(card: CardDto, state: CardRailState): CardRailEffect[] {
  const effects = new Map<number, CardRailEffect>();

  if (state.kind === "saga") {
    for (const chapter of card.sagaChapters ?? []) {
      for (const position of chapter.chapters) {
        appendEffect(effects, position, chapter.oracle);
      }
    }
  } else {
    for (const level of card.classLevels ?? []) {
      appendEffect(effects, level.level, level.oracle, level.cost);
    }
  }

  return state.notches.flatMap((notch) => {
    const effect = effects.get(notch.position);
    return effect ? [effect] : [];
  });
}
