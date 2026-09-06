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
  flavorText: string;
  planeswalker: boolean;
}

export interface RulesPreviewDisplay {
  name: string;
  manaCost: string;
  typeLine: string;
  faceIndex: 0 | 1;
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

function sectionFromFace(face: CardFace): RulesPreviewSection {
  return {
    name: face.name,
    manaCost: face.manaCost ?? "",
    typeLine: face.typeLine ?? "",
    rulesText: face.oracleText ?? "",
    flavorText: face.flavorText ?? "",
    planeswalker: /\bPlaneswalker\b/i.test(face.typeLine ?? ""),
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

export function rulesTextEntries(
  rulesText: string,
  progression: CardPresentation["progression"],
): string[] {
  const progressionEffects = new Set(
    (progression?.effects ?? []).flatMap((effect) =>
      effect.text.split("\n").map(normalizeAbilityText).filter(Boolean),
    ),
  );
  return rulesText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      if (
        progression?.rail.kind === "saga" &&
        /^(?:[IVXLCDM]+(?:,\s*[IVXLCDM]+)*)\s+[—–-]\s+/.test(line)
      ) {
        return false;
      }
      if (progressionEffects.has(normalizeAbilityText(line))) return false;
      if (progression?.rail.kind === "class" && /^.*:\s*Level\s+\d+$/.test(line)) return false;
      return true;
    });
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
    return {
      name: info?.name ?? presentation.name,
      manaCost: "",
      typeLine: info?.type_line ?? presentation.typeLine,
      faceIndex: 0,
      currentFace: true,
      otherFace: false,
      horizontal,
      multipart: true,
      flippable: false,
      faceless: false,
      sections: resolved.faces.map(sectionFromFace),
      ...additionalRulesDetails(
        presentation,
        resolved.faces.map((part) => part.oracleText ?? "").join("\n"),
      ),
      stats: presentation.stats,
      loyalty: presentation.loyalty,
      defense: presentation.defense,
    };
  }

  const rulesText = currentFace ? presentation.rulesText : (face?.oracleText ?? "");
  const typeLine = currentFace
    ? presentation.typeLine || face?.typeLine || ""
    : (face?.typeLine ?? presentation.typeLine);
  const manaCost = currentFace
    ? (presentation.effectiveManaCost ??
      (flippable ? (face?.manaCost ?? presentation.manaCost) : presentation.manaCost))
    : (face?.manaCost ?? "");
  const section: RulesPreviewSection = {
    name: face?.name ?? presentation.name,
    manaCost,
    typeLine,
    rulesText,
    flavorText: face?.flavorText ?? "",
    planeswalker: /\bPlaneswalker\b/i.test(typeLine),
  };
  const stats = currentFace ? presentation.stats : printedStats(face);
  const loyalty = currentFace
    ? (presentation.loyalty ?? numericValue(face?.loyalty))
    : numericValue(face?.loyalty);
  const defense = currentFace
    ? (presentation.defense ?? numericValue(face?.defense))
    : numericValue(face?.defense);

  return {
    name: face?.name ?? presentation.name,
    manaCost,
    typeLine,
    faceIndex,
    currentFace,
    otherFace: flippable && !currentFace,
    horizontal,
    multipart: false,
    flippable,
    faceless: false,
    sections: [section],
    ...(currentFace
      ? additionalRulesDetails(presentation, rulesText)
      : { keywords: [], costs: [] }),
    stats,
    loyalty,
    defense,
  };
}
