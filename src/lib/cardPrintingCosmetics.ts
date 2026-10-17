import type {
  CardArtPlacement,
  CardPrintingElementOverride,
  CardPrintingElements,
  CardPrintingFace,
  CardPrintingOverrides,
  CardPrintingPreset,
  CardPrintingSelection,
} from "@/protocol/deck";

export const CARD_PRINTING_PRESETS = [
  "match",
  "lea",
  "leb",
  "2ed",
  "3ed",
  "4ed",
  "leg",
  "mir",
  "7ed",
  "8ed",
  "plc",
  "plc-colorshifted",
  "fut-regular",
  "fut",
  "m15",
  "m21",
] as const satisfies readonly CardPrintingPreset[];

export function cosmeticRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  if (
    Object.values(Object.getOwnPropertyDescriptors(value)).some((d) => !Object.hasOwn(d, "value"))
  ) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function option<T extends string>(value: unknown, values: readonly T[]): T | undefined {
  return typeof value === "string" && values.includes(value as T) ? (value as T) : undefined;
}

function number(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value === 0
      ? 0
      : value
    : undefined;
}

function pair(value: unknown, min: number, max: number): [number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const x = number(value[0], min, max);
  const y = number(value[1], min, max);
  return x === undefined || y === undefined ? undefined : [x, y];
}

function normalizeElement(
  value: unknown,
  inherited: boolean,
): CardPrintingElementOverride | undefined {
  const input = cosmeticRecord(value);
  if (!input) return undefined;
  const result: CardPrintingElementOverride = {};
  if (typeof input.hidden === "boolean") result.hidden = input.hidden;
  const offset = pair(input.offset, -100, 100);
  if (offset && (inherited || offset.some((n) => n !== 0))) result.offset = offset;
  return Object.keys(result).length ? result : undefined;
}

function normalizeElements(value: unknown, inherited: boolean): CardPrintingElements | undefined {
  const input = cosmeticRecord(value);
  if (!input) return undefined;
  const result: CardPrintingElements = {};
  for (const key of ["artist", "legal", "collector", "manaCost", "setSymbol"] as const) {
    const element = normalizeElement(input[key], inherited);
    if (element) result[key] = element;
  }
  return Object.keys(result).length ? result : undefined;
}

function normalizeOverrides(value: unknown, inherited = false): CardPrintingOverrides | undefined {
  const input = cosmeticRecord(value);
  if (!input) return undefined;
  const result: CardPrintingOverrides = {};
  for (const key of ["artist", "legalText", "collectorNumber"] as const) {
    const text = input[key];
    if (typeof text === "string" && text.length <= 2048) result[key] = text;
  }
  const total = number(input.collectorTotal, 1, 99999);
  if (total !== undefined && Number.isInteger(total)) result.collectorTotal = total;
  const format = option(input.collectorFormat, ["number-first", "rarity-first"] as const);
  if (format) result.collectorFormat = format;
  if (
    typeof input.collectorLanguage === "string" &&
    /^[A-Za-z]{2,5}$/.test(input.collectorLanguage)
  ) {
    result.collectorLanguage = input.collectorLanguage;
  }
  for (const key of ["collectorSetCode", "styleSetCode"] as const) {
    const code = input[key];
    if (typeof code === "string" && /^[A-Za-z0-9_-]{1,16}$/.test(code)) result[key] = code;
  }
  if (
    Array.isArray(input.frameColors) &&
    input.frameColors.length <= 5 &&
    input.frameColors.every((c) => option(c, ["W", "U", "B", "R", "G"] as const)) &&
    new Set(input.frameColors).size === input.frameColors.length
  ) {
    result.frameColors = [...input.frameColors] as CardPrintingOverrides["frameColors"];
  }
  const future = option(input.futureTreatment, ["regular", "full-art", "clear"] as const);
  if (future) result.futureTreatment = future;
  if (
    typeof input.setSymbolCode === "string" &&
    /^[A-Za-z0-9_-]{1,16}$/.test(input.setSymbolCode)
  ) {
    result.setSymbolCode = input.setSymbolCode;
  }
  const mask = option(input.setSymbolMask, ["auto", "alpha", "ink"] as const);
  if (mask) result.setSymbolMask = mask;
  const style = option(input.symbolStyle, ["original", "modern"] as const);
  if (style) result.symbolStyle = style;
  const border = option(input.borderColor, ["black", "white", "silver"] as const);
  if (border) result.borderColor = border;
  const stamp = option(input.securityStamp, [
    "none",
    "oval",
    "triangle",
    "acorn",
    "circle",
    "arena",
    "heart",
  ] as const);
  if (stamp) result.securityStamp = stamp;
  const elements = normalizeElements(input.elements, inherited);
  if (elements) result.elements = elements;
  return Object.keys(result).length ? result : undefined;
}

function normalizeArt(value: unknown, inherited = false): CardArtPlacement | undefined {
  const input = cosmeticRecord(value);
  if (!input) return undefined;
  const mode = option(input.mode, ["window", "behind-text"] as const);
  if (!mode) return undefined;
  const result: CardArtPlacement = { mode };
  const focalPoint = pair(input.focalPoint, 0, 1);
  if (focalPoint && (inherited || focalPoint.some((n) => n !== 0.5)))
    result.focalPoint = focalPoint;
  const zoom = number(input.zoom, 1, 8);
  if (zoom !== undefined && (inherited || zoom !== 1)) result.zoom = zoom;
  const opacity = number(input.paperOpacity, 0, 1);
  if (mode === "behind-text" && opacity !== undefined && (inherited || opacity !== 0.8))
    result.paperOpacity = opacity;
  return result;
}

function normalizeFace(value: unknown): CardPrintingFace {
  const input = cosmeticRecord(value);
  const result: CardPrintingFace = {};
  if (!input) return result;
  const preset = option(input.preset, CARD_PRINTING_PRESETS);
  if (preset) result.preset = preset;
  const overrides = normalizeOverrides(input.overrides, true);
  if (overrides) result.overrides = overrides;
  const art = normalizeArt(input.art, true);
  if (art) result.art = art;
  return result;
}

export function normalizeCardPrintingSelection(value: unknown): CardPrintingSelection | undefined {
  const input = cosmeticRecord(value);
  if (!input || input.version !== 1) return undefined;
  const preset = option(input.preset, CARD_PRINTING_PRESETS);
  if (!preset) return undefined;
  if (input.faces !== undefined && (!Array.isArray(input.faces) || input.faces.length > 2))
    return undefined;
  const result: CardPrintingSelection = { version: 1, preset };
  const overrides = normalizeOverrides(input.overrides);
  if (overrides) result.overrides = overrides;
  const art = normalizeArt(input.art);
  if (art) result.art = art;
  if (Array.isArray(input.faces)) {
    const faces = input.faces.map(normalizeFace);
    while (faces.length && !Object.keys(faces[faces.length - 1]).length) faces.pop();
    if (faces.length) result.faces = faces;
  }
  return preset === "match" && !result.overrides && !result.art && !result.faces
    ? undefined
    : result;
}
