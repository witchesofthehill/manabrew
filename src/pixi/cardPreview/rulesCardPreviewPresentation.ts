import {
  replaceCardName,
  type CardPresentation,
  type CardStatPresentation,
} from "@/components/game/cardPresentation";
import type { CardDto } from "@/protocol/game";
import type { HandActionOption } from "@/stores/useGameUIStore";
import { resolveCardFaces, type CardFace } from "@/lib/cardFaces";
import { isHorizontalCard, isTwoHalfLayout } from "@/lib/cardLayout";
import type { ScryfallCard } from "@/types/scryfall";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
import { parseManaCost } from "@/pixi/manaSymbols";

export interface RulesPreviewSection {
  faceIndex: number;
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
  stats: CardStatPresentation | null;
  loyalty: number | null;
  defense: number | null;
}

export interface StationRulesTier {
  threshold: number;
  text: string;
  canonicalText: string;
}

export interface StationRulesPresentation {
  opening: string[];
  tiers: StationRulesTier[];
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
  localized: string | null;
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

function abilityCost(text: string): string | null {
  return (
    text
      .trim()
      .match(/^((?:\{[^{}]+\}[,\s、，]*)+)[:：]/)?.[1]
      ?.replace(/[,\s、，]/g, "") ?? null
  );
}

function withoutAbilityCost(text: string): string {
  return text.replace(/^(?:\{[^{}]+\}[,\s、，]*)+[:：]\s*/, "");
}

function normalizedRulesComparisonText(text: string): string {
  const normalized = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[—–]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const cost = abilityCost(normalized);
  return cost === null ? normalized : `${cost}: ${withoutAbilityCost(normalized)}`;
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
  const entries: TranslationLine[] = canonicalLines.map((canonical) => ({
    canonical: translationComparisonText(canonical),
    localized: null,
  }));
  if (canonicalLines.length === localizedLines.length) {
    entries.forEach((entry, index) => {
      entry.localized = localizedLines[index]!.trim();
    });
  } else {
    const canonicalByCost = new Map<string, number[]>();
    const localizedByCost = new Map<string, number[]>();
    canonicalLines.forEach((line, index) => {
      const cost = abilityCost(line);
      if (cost) {
        const indices = canonicalByCost.get(cost);
        if (indices) indices.push(index);
        else canonicalByCost.set(cost, [index]);
      }
    });
    localizedLines.forEach((line, index) => {
      const cost = abilityCost(line);
      if (cost) {
        const indices = localizedByCost.get(cost);
        if (indices) indices.push(index);
        else localizedByCost.set(cost, [index]);
      }
    });
    const pairs: [number, number][] = [];
    for (const [cost, canonicalIndices] of canonicalByCost) {
      const localizedIndices = localizedByCost.get(cost);
      if (localizedIndices?.length !== canonicalIndices.length) continue;
      canonicalIndices.forEach((canonicalIndex, index) => {
        pairs.push([canonicalIndex, localizedIndices[index]!]);
      });
    }
    pairs.sort(([left], [right]) => left - right);
    if (
      pairs.every(
        ([, localizedIndex], index) => index === 0 || localizedIndex > pairs[index - 1]![1],
      )
    ) {
      for (const [canonicalIndex, localizedIndex] of pairs) {
        entries[canonicalIndex]!.localized = localizedLines[localizedIndex]!.trim();
      }
    }
  }
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
      const match = closestRulesLine(replaceCardName(line, face.canonicalName), mappings);
      if (!match?.localized) return line;
      return abilityCost(translationComparisonText(line)) !== null
        ? match.localized
        : withoutAbilityCost(match.localized);
    })
    .join("\n");
}

function closestRulesLine(
  text: string,
  lines: TranslationLine[],
  allowFuzzy = false,
): TranslationLine | null {
  const comparison = normalizedRulesComparisonText(translationComparisonText(text));
  if (!comparison) return null;
  const cost = abilityCost(comparison);
  let match: TranslationLine | null = null;
  let minimumDistance = comparison.length;
  let ambiguous = false;
  for (const candidate of lines) {
    const candidateText = normalizedRulesComparisonText(candidate.canonical);
    const candidateCost = abilityCost(candidateText);
    if (cost !== null && candidateCost !== null && candidateCost !== cost) continue;
    const canonical = cost !== null ? candidateText : withoutAbilityCost(candidateText);
    const threshold = allowFuzzy
      ? Math.floor(Math.min(canonical.length, comparison.length) / 3)
      : 0;
    const distance =
      canonical === comparison
        ? 0
        : allowFuzzy
          ? editDistanceWithin(canonical, comparison, threshold)
          : null;
    if (distance !== null && distance < minimumDistance) {
      minimumDistance = distance;
      match = candidate;
      ambiguous = false;
    } else if (
      distance !== null &&
      distance === minimumDistance &&
      candidate.localized !== match?.localized
    ) {
      ambiguous = true;
    }
  }
  return ambiguous ? null : match;
}

function parseStationRules(rulesText: string, canonical: boolean): StationRulesPresentation | null {
  const lines = rulesText.replace(/\r\n?/g, "\n").split("\n");
  if (canonical && !lines.some((line) => /^Station(?:\s*\(.*\))?\s*$/i.test(line.trim()))) {
    return null;
  }
  const opening: string[] = [];
  const tiers: StationRulesTier[] = [];
  let effectLines: string[] = [];
  const finishTier = () => {
    const tier = tiers[tiers.length - 1];
    if (!tier) return;
    tier.text = effectLines.join("\n").trim();
    tier.canonicalText = tier.text;
  };
  for (const sourceLine of lines) {
    const line = sourceLine.trim();
    const heading =
      line.match(/^(?:STATION\s+)?(\d+)\s*\+\s*[|｜]\s*(.*)$/i) ??
      line.match(/^STATION\s+(\d+)\s*\+(?:\s+(.*))?$/i) ??
      (!canonical ? line.match(/^[\p{L}\p{M}][\p{L}\p{M}\s-]*\s+(\d+)\s*\+$/u) : null);
    if (heading) {
      finishTier();
      tiers.push({ threshold: Number(heading[1]), text: "", canonicalText: "" });
      effectLines = heading[2] ? [heading[2]] : [];
    } else if (tiers.length > 0) {
      effectLines.push(line);
    } else if (line) {
      opening.push(line);
    }
  }
  finishTier();
  return tiers.length > 0 && tiers.every((tier) => tier.text) ? { opening, tiers } : null;
}

export function stationRulesPresentation(
  rulesText: string,
  canonicalRulesText = rulesText,
): StationRulesPresentation | null {
  const canonical = parseStationRules(canonicalRulesText, true);
  if (!canonical || rulesText === canonicalRulesText) return canonical;
  const localized = parseStationRules(rulesText, false);
  if (
    !localized ||
    localized.tiers.length !== canonical.tiers.length ||
    localized.tiers.some((tier, index) => tier.threshold !== canonical.tiers[index]!.threshold)
  ) {
    return canonical;
  }
  return {
    opening: localized.opening,
    tiers: localized.tiers.map((tier, index) => ({
      ...tier,
      canonicalText: canonical.tiers[index]!.text,
    })),
  };
}

function mechanicPaymentIsDescribed(action: HandActionOption, cost: string): boolean {
  if (action.kind !== "ability" || action.isManaAbility) return false;
  const description = normalizedRulesComparisonText(
    translationComparisonText(action.abilityText ?? action.label),
  );
  if (description === "station") {
    return /^Tap another (?:untapped )?creature you control\.?$/i.test(cost);
  }
  const crew = description.match(/^crew\s+(\d+)$/);
  const payment = cost.match(
    /^Tap any number of (?:untapped )?creatures you control(?: other than .+)? with total power (\d+) or (?:greater|more)\.?$/i,
  );
  return crew !== null && payment !== null && crew[1] === payment[1];
}

export function actionRowText(action: HandActionOption, displayLabel?: string): string {
  const symbols = action.displayManaLetters?.map((letter) => `{${letter}}`).join("") ?? "";
  const baseLabel = action.isManaAbility && symbols ? action.label : (displayLabel ?? action.label);
  const label = symbols && !baseLabel.includes(symbols) ? `${baseLabel} ${symbols}` : baseLabel;
  const cost = action.cost?.trim();
  if (
    !cost ||
    mechanicPaymentIsDescribed(action, cost) ||
    label
      .replace(/\([^()]*\)/g, "")
      .toLowerCase()
      .includes(cost.toLowerCase())
  )
    return label;
  return `${cost}: ${label}`;
}

export function activatedRulesEntries(
  actions: ReadonlyArray<{ action: HandActionOption; displayLabel: string }>,
  entries: string[],
  localize: (text: string) => string,
): Map<number, string> {
  const matches = new Map<number, string>();
  actions.forEach(({ action, displayLabel }, index) => {
    if (action.kind !== "ability") return;
    const text = action.abilityText ? localize(action.abilityText) : displayLabel;
    const entry = matchRulesEntry(text, entries, action.cost?.trim());
    if (entry !== null) matches.set(index, entries[entry]!);
  });
  return matches;
}

export function stackHighlightEntry(effect: string | undefined, entries: string[]): string | null {
  const ability = effect?.trim();
  if (!ability || entries.some((entry) => rulesEntryMatchesStackAbility(entry, ability))) {
    return null;
  }
  const index = matchRulesEntry(ability, entries);
  if (index !== null) return entries[index]!;
  return closestRulesLine(ability, rulesEntryLines(entries), true)?.localized ?? null;
}

function rulesEntryLines(entries: string[]): TranslationLine[] {
  return entries.map((entry) => ({
    canonical: translationComparisonText(entry).replace(/^\((.*)\)$/, "$1"),
    localized: entry,
  }));
}

export function matchRulesEntry(
  text: string,
  entries: string[],
  actionCost?: string,
): number | null {
  const lines = rulesEntryLines(entries);
  const visible = translationComparisonText(text);
  const match =
    closestRulesLine(text, lines) ??
    (actionCost && !visible.includes(actionCost)
      ? closestRulesLine(`${visible} ${actionCost}`, lines)
      : null);
  if (match) return lines.indexOf(match);
  const choices = manaChoices(text);
  if (!choices) return null;
  const cost = abilityCost(text);
  const index = lines.findIndex(({ canonical }) => {
    const alternatives = manaChoices(canonical);
    return (
      alternatives !== null &&
      abilityCost(canonical) === cost &&
      choices.every((choice) => alternatives.includes(choice))
    );
  });
  return index >= 0 ? index : null;
}

function manaChoices(text: string): string[] | null {
  return (
    text
      .trim()
      .match(
        /^(?:\{[^{}]+\}[,\s]*)+:\s*Add ((?:\{[^{}]+\})+(?:(?:,?\s+or|,)\s+(?:\{[^{}]+\})+)*)\.?$/,
      )?.[1]
      ?.split(/(?:,?\s+or|,)\s+/) ?? null
  );
}

function sectionFromFace(
  face: CardFace,
  localized: LocalizedFaceText | null,
  faceIndex: number,
): RulesPreviewSection {
  const typeLine = localized?.displayTypeLine ?? face.typeLine ?? "";
  return {
    faceIndex,
    name: localized?.displayName ?? face.name,
    manaCost: face.manaCost ?? "",
    typeLine,
    rulesText: localized?.displayRulesText ?? face.oracleText ?? "",
    canonicalRulesText: localized?.canonicalRulesText ?? face.oracleText ?? "",
    flavorText: face.flavorText ?? "",
    planeswalker: /\bPlaneswalker\b/i.test(localized?.canonicalTypeLine ?? face.typeLine ?? ""),
  };
}

function grantedKeywordChips(card: CardDto): string[] {
  return [
    ...new Set(
      card.grantedKeywords.map((keyword) => card.keywordLabels?.[keyword] ?? keywordText(keyword)),
    ),
  ];
}

function manaText(cost: string): string {
  const codes = parseManaCost(cost);
  return codes.length === cost.trim().split(/\s+|(?<=\})(?=\{)/).length
    ? codes.map((code) => `{${code}}`).join("")
    : "";
}

function keywordText(keyword: string): string {
  const separator = keyword.indexOf(":");
  if (separator < 0) return keyword.trim();
  const label = keyword.slice(0, separator).trim();
  const mana = manaText(keyword.slice(separator + 1));
  return mana ? `${label} ${mana}` : label;
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
  const simultaneous =
    isTwoHalfLayout(layout) || layout === "adventure" || layout === "prepare" || layout === "flip";
  const flippable = resolved.isFlippable && !simultaneous && !faceless;
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
      name: i18n._(msg`Face-down card`),
      manaCost: "",
      typeLine: i18n._(msg`Face-down permanent`),
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
      stats: presentation.stats,
      loyalty: presentation.loyalty,
      defense: presentation.defense,
    };
  }

  if (!flippable && resolved.isMultiFaced) {
    const sections = resolved.faces.map((part, index) =>
      sectionFromFace(part, localizedFaceText(info, index), index),
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
      keywords: grantedKeywordChips(card),
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
    faceIndex,
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
    keywords: currentFace ? grantedKeywordChips(card) : [],
    stats,
    loyalty,
    defense,
  };
}
