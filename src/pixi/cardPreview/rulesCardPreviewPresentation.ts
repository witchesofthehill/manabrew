import type { CardPresentation, CardStatPresentation } from "@/components/game/cardPresentation";
import type { CardDto } from "@/protocol/game";
import { resolveCardFaces, type CardFace } from "@/lib/cardFaces";
import { isHorizontalCard, isTwoHalfLayout } from "@/lib/cardLayout";
import type { ScryfallCard } from "@/types/scryfall";

export interface RulesPreviewSection {
  name: string;
  manaCost: string;
  typeLine: string;
  rulesText: string;
  canonicalRulesText: string;
  flavorText: string;
  planeswalker: boolean;
}

export interface RulesPreviewDisplay {
  name: string;
  manaCost: string;
  typeLine: string;
  faceIndex: 0 | 1;
  liveFaceIndex: 0 | 1;
  currentFace: boolean;
  otherFace: boolean;
  horizontal: boolean;
  multipart: boolean;
  flippable: boolean;
  faceless: boolean;
  sections: RulesPreviewSection[];
  keywords: string[];
  costs: CardPresentation["costs"];
  stats: CardStatPresentation | null;
  loyalty: number | null;
  defense: number | null;
}

function numericValue(value: string | undefined): number | null {
  if (value == null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function printedStats(face: CardFace | undefined): CardStatPresentation | null {
  if (!face?.power || !face.toughness) return null;
  return {
    power: face.power,
    toughness: face.toughness,
    state: "neutral",
    damage: 0,
  };
}

type ScryfallCardFace = NonNullable<ScryfallCard["card_faces"]>[number];

interface LocalizedFaceText {
  canonicalName: string;
  canonicalTypeLine: string;
  canonicalRulesText: string;
  displayName: string;
  displayTypeLine: string;
  displayRulesText: string;
}

interface TranslationLine {
  canonical: string;
  localized: string;
}

const translationLinesByCard = new WeakMap<ScryfallCard, Map<number, TranslationLine[]>>();
const FACE_SEPARATOR = " // ";

function scryfallFace(info: ScryfallCard, faceIndex: number): ScryfallCard | ScryfallCardFace {
  return info.card_faces?.[faceIndex] ?? info;
}

function localizedFaceText(info: ScryfallCard | null, faceIndex: number): LocalizedFaceText | null {
  if (!info) return null;
  const face = scryfallFace(info, faceIndex);
  const canonicalName = face.name;
  const canonicalTypeLine = face.type_line ?? info.type_line;
  const canonicalRulesText = face.oracle_text ?? info.oracle_text ?? "";
  return {
    canonicalName,
    canonicalTypeLine,
    canonicalRulesText,
    displayName: face.printed_name ?? canonicalName,
    displayTypeLine: face.printed_type_line ?? canonicalTypeLine,
    displayRulesText: face.printed_text ?? canonicalRulesText,
  };
}

function comparableText(text: string): string {
  return text.toLowerCase().replace(/[—–-]/g, " ").replace(/\s+/g, " ").trim();
}

function localizedLiveValue(live: string, canonical: string, localized: string): string {
  if (!live) return localized || canonical;
  if (localized && comparableText(live) === comparableText(canonical)) return localized;
  return live;
}

function translationComparisonText(text: string): string {
  const trimmed = text.trim();
  return trimmed.startsWith("(") ? trimmed : trimmed.replace(/\(.*\)/g, "").trim();
}

function editDistanceWithin(left: string, right: string, threshold: number): number | null {
  if (Math.abs(left.length - right.length) > threshold) return null;
  const previous = new Uint16Array(right.length + 1);
  const current = new Uint16Array(right.length + 1);
  for (let column = 0; column <= right.length; column += 1) previous[column] = column;
  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;
    let rowMinimum = row;
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        previous[column]! + 1,
        current[column - 1]! + 1,
        previous[column - 1]! + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
      rowMinimum = Math.min(rowMinimum, current[column]!);
    }
    if (rowMinimum > threshold) return null;
    previous.set(current);
  }
  const distance = previous[right.length]!;
  return distance <= threshold ? distance : null;
}

function translationLines(info: ScryfallCard, faceIndex: number): TranslationLine[] {
  let cardEntries = translationLinesByCard.get(info);
  if (!cardEntries) {
    cardEntries = new Map();
    translationLinesByCard.set(info, cardEntries);
  }
  const cached = cardEntries.get(faceIndex);
  if (cached) return cached;
  const face = localizedFaceText(info, faceIndex);
  const canonicalLines = face?.canonicalRulesText.split("\n") ?? [];
  const localizedLines = face?.displayRulesText.split("\n") ?? [];
  const entries = canonicalLines.slice(0, localizedLines.length).map((canonical, index) => ({
    canonical: translationComparisonText(canonical),
    localized: localizedLines[index]!.trim(),
  }));
  cardEntries.set(faceIndex, entries);
  return entries;
}

export function localizeRulesPreviewText(
  text: string,
  info: ScryfallCard | null,
  faceIndex: number,
): string {
  if (!text || !info) return text;
  const face = localizedFaceText(info, faceIndex);
  if (!face || face.displayRulesText === face.canonicalRulesText) return text;
  if (text.trim() === face.canonicalRulesText.trim()) return face.displayRulesText;
  const mappings = translationLines(info, faceIndex);
  return text
    .split("\n")
    .map((line) => {
      const comparison = translationComparisonText(line);
      if (!comparison) return line;
      let match: TranslationLine | null = null;
      let minimumDistance = comparison.length;
      for (const candidate of mappings) {
        const threshold = Math.floor(Math.min(candidate.canonical.length, comparison.length) / 3);
        const distance = editDistanceWithin(candidate.canonical, comparison, threshold);
        if (distance !== null && distance < minimumDistance) {
          minimumDistance = distance;
          match = candidate;
        }
      }
      return match?.localized ?? line;
    })
    .join("\n");
}

function sectionFromFace(face: CardFace, localized: LocalizedFaceText | null): RulesPreviewSection {
  const typeLine = localized?.displayTypeLine ?? face.typeLine ?? "";
  return {
    name: localized?.displayName ?? face.name,
    manaCost: face.manaCost ?? "",
    typeLine,
    rulesText: localized?.displayRulesText ?? face.oracleText ?? "",
    canonicalRulesText: localized?.canonicalRulesText ?? face.oracleText ?? "",
    flavorText: face.flavorText ?? "",
    planeswalker: /\bPlaneswalker\b/i.test(localized?.canonicalTypeLine ?? face.typeLine ?? ""),
  };
}

function additionalRulesDetails(presentation: CardPresentation, rulesText: string) {
  let depth = 0;
  let withoutReminder = "";
  for (const character of rulesText) {
    if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0) withoutReminder += character;
  }
  const normalize = (text: string) =>
    text
      .toLowerCase()
      .replace(/[:—–]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[.\s]+$/, "");
  const visibleEntries = new Set(
    withoutReminder
      .split(/[\n,;•]/)
      .map(normalize)
      .filter(Boolean),
  );
  const keywordKeys = new Set<string>();
  const keywords = presentation.keywords.filter((keyword) => {
    const key = normalize(keyword);
    if (!key || keywordKeys.has(key)) return false;
    keywordKeys.add(key);
    visibleEntries.add(key);
    return true;
  });
  const costs = presentation.costs.filter(({ label, cost }) => {
    const key = normalize(`${label} ${cost}`);
    if (visibleEntries.has(key)) return false;
    visibleEntries.add(key);
    return true;
  });
  return { keywords, costs };
}

function normalizeAbilityText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”"'’.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function rulesEntryMatchesStackAbility(entry: string, ability: string): boolean {
  const normalizedEntry = normalizeAbilityText(entry);
  const normalizedAbility = normalizeAbilityText(ability);
  if (!normalizedEntry || !normalizedAbility) return false;
  if (normalizedEntry === normalizedAbility) return true;
  const shorterLength = Math.min(normalizedEntry.length, normalizedAbility.length);
  return (
    shorterLength >= 12 &&
    (normalizedEntry.includes(normalizedAbility) || normalizedAbility.includes(normalizedEntry))
  );
}

export function rulesTextEntries(
  rulesText: string,
  progression: CardPresentation["progression"],
  canonicalRulesText = rulesText,
): string[] {
  const progressionEffects = new Set(
    (progression?.effects ?? []).flatMap((effect) =>
      effect.text.split("\n").map(normalizeAbilityText).filter(Boolean),
    ),
  );
  const canonicalLines = canonicalRulesText.split("\n").map((line) => line.trim());
  return rulesText
    .split("\n")
    .map((line, index) => ({ line: line.trim(), canonical: canonicalLines[index]?.trim() ?? "" }))
    .filter(({ line }) => Boolean(line))
    .filter(({ line, canonical }) => {
      if (
        progression?.rail.kind === "saga" &&
        /^(?:[IVXLCDM]+(?:,\s*[IVXLCDM]+)*)\s+[—–-]\s+/.test(canonical || line)
      ) {
        return false;
      }
      if (progressionEffects.has(normalizeAbilityText(line))) return false;
      if (progression?.rail.kind === "class" && /^.*:\s*Level\s+\d+$/.test(canonical || line)) {
        return false;
      }
      return true;
    })
    .map(({ line }) => line);
}

export function resolveRulesPreviewDisplay(options: {
  card: CardDto;
  presentation: CardPresentation;
  info: ScryfallCard | null;
  deckLayout?: string;
  showBackFace: boolean;
  faceless: boolean;
}): RulesPreviewDisplay {
  const { card, presentation, info, deckLayout, showBackFace, faceless } = options;
  const resolved = resolveCardFaces(info ?? undefined);
  const layout = deckLayout ?? info?.layout;
  const flippable = resolved.isFlippable && !faceless;
  const faceIndex: 0 | 1 = showBackFace && flippable ? 1 : 0;
  const currentFaceIndex: 0 | 1 = card.isTransformed && flippable ? 1 : 0;
  const currentFace = faceIndex === currentFaceIndex;
  const face = resolved.faces[faceIndex];
  const horizontal = isHorizontalCard({
    layout: isTwoHalfLayout(layout) ? layout : undefined,
    types: face ? undefined : card.types,
    typeLine: face?.typeLine ?? info?.type_line,
  });

  if (faceless) {
    return {
      name: "Face-down card",
      manaCost: "",
      typeLine: "Face-down permanent",
      faceIndex: 0,
      liveFaceIndex: 0,
      currentFace: true,
      otherFace: false,
      horizontal: false,
      multipart: false,
      flippable: false,
      faceless: true,
      sections: [],
      keywords: [],
      costs: [],
      stats: presentation.stats,
      loyalty: presentation.loyalty,
      defense: presentation.defense,
    };
  }

  if (!flippable && resolved.isMultiFaced) {
    const sections = resolved.faces.map((part, index) =>
      sectionFromFace(part, localizedFaceText(info, index)),
    );
    const name =
      info?.printed_name ??
      (sections.map((section) => section.name).join(FACE_SEPARATOR) ||
        info?.name ||
        presentation.name);
    const typeLine =
      info?.printed_type_line ??
      (sections.map((section) => section.typeLine).join(FACE_SEPARATOR) ||
        info?.type_line ||
        presentation.typeLine);
    return {
      name,
      manaCost: "",
      typeLine,
      faceIndex: 0,
      liveFaceIndex: 0,
      currentFace: true,
      otherFace: false,
      horizontal,
      multipart: true,
      flippable: false,
      faceless: false,
      sections,
      ...additionalRulesDetails(
        presentation,
        sections.map((part) => part.canonicalRulesText).join("\n"),
      ),
      stats: presentation.stats ?? printedStats(resolved.faces[0]),
      loyalty: presentation.loyalty,
      defense: presentation.defense,
    };
  }

  const localized = localizedFaceText(info, faceIndex);
  const canonicalRulesText = localized?.canonicalRulesText ?? face?.oracleText ?? "";
  const liveRulesText = currentFace
    ? presentation.rulesText || canonicalRulesText
    : canonicalRulesText;
  const rulesText = currentFace
    ? localizeRulesPreviewText(liveRulesText, info, faceIndex)
    : (localized?.displayRulesText ?? liveRulesText);
  const typeLine = currentFace
    ? localizedLiveValue(
        presentation.typeLine,
        localized?.canonicalTypeLine ?? face?.typeLine ?? "",
        localized?.displayTypeLine ?? face?.typeLine ?? "",
      )
    : (localized?.displayTypeLine ?? face?.typeLine ?? presentation.typeLine);
  const name = currentFace
    ? localizedLiveValue(
        presentation.name,
        localized?.canonicalName ?? face?.name ?? "",
        localized?.displayName ?? face?.name ?? "",
      )
    : (localized?.displayName ?? face?.name ?? presentation.name);
  const manaCost = currentFace
    ? presentation.effectiveManaCost !== undefined
      ? presentation.effectiveManaCost
      : presentation.manaCost || face?.manaCost || ""
    : (face?.manaCost ?? "");
  const section: RulesPreviewSection = {
    name,
    manaCost,
    typeLine,
    rulesText,
    canonicalRulesText: liveRulesText,
    flavorText: face?.flavorText ?? "",
    planeswalker: /\bPlaneswalker\b/i.test(
      currentFace ? presentation.typeLine : (localized?.canonicalTypeLine ?? face?.typeLine ?? ""),
    ),
  };
  const stats = currentFace ? (presentation.stats ?? printedStats(face)) : printedStats(face);
  const loyalty = currentFace
    ? (presentation.loyalty ?? numericValue(face?.loyalty))
    : numericValue(face?.loyalty);
  const defense = currentFace
    ? (presentation.defense ?? numericValue(face?.defense))
    : numericValue(face?.defense);

  return {
    name,
    manaCost,
    typeLine,
    faceIndex,
    liveFaceIndex: currentFaceIndex,
    currentFace,
    otherFace: flippable && !currentFace,
    horizontal,
    multipart: false,
    flippable,
    faceless: false,
    sections: [section],
    ...(currentFace
      ? additionalRulesDetails(presentation, liveRulesText)
      : { keywords: [], costs: [] }),
    stats,
    loyalty,
    defense,
  };
}
