import {
  faceFrame,
  type RenderedCardInput,
  type FrameColor,
  type SecurityStamp,
  type SemanticCardInput,
} from "card-glint/magic/presentation";
import type { CardFaceLiveChanges, CardFaceSnapshot, PreparedCard } from "@/lib/cardRenderSnapshot";
import { getTheme } from "@/hooks/useTheme";
import {
  CardRenderError,
  supportsRetroCardFrame,
  type CardRenderDecision,
} from "@/lib/cardRenderDecision";

const SUPPORTED_LAYOUTS: Record<string, true> = {
  normal: true,
  token: true,
  double_faced_token: true,
  emblem: true,
  transform: true,
  modal_dfc: true,
  meld: true,
  reversible_card: true,
  saga: true,
  class: true,
  leveler: true,
  planeswalker: true,
  adventure: true,
  prepare: true,
  split: true,
  aftermath: true,
  flip: true,
  battle: true,
  room: true,
  planar: true,
  scheme: true,
  vanguard: true,
  art_series: true,
  front_card: true,
};
const STAMPS: Partial<Record<SecurityStamp, true>> = {
  none: true,
  oval: true,
  triangle: true,
  acorn: true,
  circle: true,
  arena: true,
  heart: true,
};
const RARITIES: Record<string, true> = {
  common: true,
  uncommon: true,
  rare: true,
  mythic: true,
  special: true,
  bonus: true,
};

function frameColors(colors: readonly string[] | undefined): FrameColor[] {
  return [
    ...new Set(colors?.filter((color): color is FrameColor => /^[WUBRG]$/.test(color)) ?? []),
  ];
}

function resolveLiveChanges(
  changes: CardFaceLiveChanges,
): NonNullable<SemanticCardInput["liveChanges"]> {
  const colors = getTheme().gameTheme.cardChange;
  const tones: Record<NonNullable<CardFaceLiveChanges["power"]>, string> = {
    buffed: colors.buffed,
    debuffed: colors.debuffed,
    added: colors.buffed,
    changed: colors.changed,
  };
  return {
    ...(changes.power ? { power: tones[changes.power] } : {}),
    ...(changes.toughness ? { toughness: tones[changes.toughness] } : {}),
    ...(changes.addedTypes
      ? {
          typeLine: {
            added: changes.addedTypes,
            color: changes.addedTypes.length ? colors.buffed : colors.removed,
          },
        }
      : {}),
  };
}

export function cardGlintFace(
  prepared: PreparedCard,
  standardFrameFallback: boolean,
): { face: SemanticCardInput; decision: CardRenderDecision } {
  const snapshot = prepared.snapshot;
  const layout = snapshot.layout ?? "normal";
  const original = (reason: string): never => {
    throw new CardRenderError({
      mode: "original",
      reason,
      layout,
      faceIndex: prepared.faceIndex,
      engine: "card-glint",
    });
  };
  if (SUPPORTED_LAYOUTS[layout] !== true) original("unknown-layout");
  const unsupportedTreatment =
    snapshot.full_art ||
    snapshot.textless ||
    snapshot.border_color === "borderless" ||
    snapshot.frame_effects?.some((effect) =>
      ["showcase", "extendedart", "inverted", "etched", "shatteredglass", "textless"].includes(
        effect,
      ),
    );
  const scanBacked = layout === "art_series" || layout === "front_card";
  const frameOverride =
    prepared.cosmetics?.frame === "modern" || prepared.cosmetics?.frame === "retro";
  const allowStandardFrame = standardFrameFallback || frameOverride;
  if (unsupportedTreatment && !allowStandardFrame && !scanBacked) original("unsupported-treatment");
  const fallbackTreatment = Boolean(unsupportedTreatment && allowStandardFrame);
  const parts = snapshot.card_faces ?? [snapshot];
  const convert = (part: CardFaceSnapshot, index: number, child = false): SemanticCardInput => {
    const canonicalType = part.type_line;
    const land = /\bLand\b/i.test(canonicalType);
    const semanticLayout = /\bSaga\b/i.test(canonicalType)
      ? "saga"
      : /\bClass\b/i.test(canonicalType)
        ? "class"
        : /\bPlaneswalker\b/i.test(canonicalType)
          ? "planeswalker"
          : /^Level up\b/m.test(part.oracle_text)
            ? "leveler"
            : undefined;
    const faceLayout = part.layout ?? (child ? "normal" : layout);
    if (SUPPORTED_LAYOUTS[faceLayout] !== true) original("unknown-layout");
    const colors = part.colors ??
      part.color_indicator ?? [...new Set(part.mana_cost.match(/[WUBRG]/g) ?? [])];
    const cosmetics = prepared.cosmetics;
    const borderColor =
      cosmetics?.border && cosmetics.border !== "printing"
        ? cosmetics.border
        : snapshot.border_color;
    const retroCompatible = supportsRetroCardFrame({
      layout: semanticLayout ?? faceLayout,
      types: canonicalType.split(/[^A-Za-z]+/),
      subtypes: [],
      text: part.oracle_text,
    });
    if (cosmetics?.frame === "retro" && !retroCompatible) original("incompatible-frame");
    const stamp = snapshot.security_stamp as SecurityStamp | undefined;
    const result: SemanticCardInput = {
      name: part.name,
      typeLine: part.type_line_display,
      artifact: /\bArtifact\b/i.test(canonicalType),
      creature: /\bCreature\b/i.test(canonicalType),
      legendary: /\bLegendary\b/i.test(canonicalType),
      land,
      colors,
      frameColors:
        land && colors.length === 0
          ? frameColors(part.produced_mana ?? part.color_identity ?? snapshot.color_identity)
          : undefined,
      manaSymbols: [...part.mana_cost.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]!),
      rulesText: part.oracle_text,
      rulesParagraphs: [
        ...part.oracle_text
          .split("\n")
          .filter(Boolean)
          .map((text) => ({ role: "rules" as const, runs: [{ text }] })),
        ...(part.flavor_text
          ? [{ role: "flavor" as const, runs: [{ text: part.flavor_text, italic: true }] }]
          : []),
      ],
      illustration: prepared.artUrls[index] ?? null,
      power: part.power,
      toughness: part.toughness,
      loyalty: part.loyalty,
      defense: part.defense,
      handModifier: part.hand_modifier,
      lifeModifier: part.life_modifier,
      scanBorder:
        scanBacked &&
        (cosmetics?.frame === "modern" ||
          (cosmetics?.border != null && cosmetics.border !== "printing")),
      layout: semanticLayout ?? faceLayout,
      frameStyle:
        cosmetics?.frame === "modern"
          ? "modern"
          : retroCompatible &&
              (cosmetics?.frame === "retro" ||
                (!fallbackTreatment && snapshot.frame && Number(snapshot.frame) < 2003))
            ? "retro"
            : "modern",
      borderColor: borderColor === "white" || borderColor === "silver" ? borderColor : "black",
      wordingMode: "oracle",
      symbolStyle: "modern",
      securityStamp: stamp && STAMPS[stamp] === true ? stamp : "none",
      securityStampEffect: "static",
      setCode: snapshot.set,
      rarity:
        snapshot.rarity && RARITIES[snapshot.rarity] === true
          ? (snapshot.rarity as RenderedCardInput["rarity"])
          : "common",
      artist: part.artist ?? snapshot.artist,
      collectorNumber: snapshot.collector_number,
    };
    if (part.liveChanges) result.liveChanges = resolveLiveChanges(part.liveChanges);
    if (faceLayout === "flip") result.frameTemplate = "flip";
    else if (/\bBattle\b/i.test(canonicalType)) result.frameTemplate = "battle";
    else if (
      !fallbackTreatment &&
      snapshot.frame === "future" &&
      (!cosmetics?.frame || cosmetics.frame === "printing")
    )
      result.frameTemplate = "future";
    return result;
  };
  const face = convert(parts[prepared.faceIndex]!, prepared.faceIndex);
  if (
    !face.illustration ||
    (prepared.combined &&
      ["split", "aftermath", "room"].includes(layout) &&
      prepared.artUrls.some((url) => !url))
  )
    original("artwork-unavailable");
  if (prepared.combined) {
    face.faces = parts.map((part, index) => convert(part, index, true));
    face.layout = layout;
    if (layout === "split" && snapshot.keywords?.includes("Aftermath")) face.layout = "aftermath";
  }
  const reverse = parts[1];
  if (
    prepared.faceIndex === 0 &&
    layout === "transform" &&
    reverse?.power != null &&
    reverse.toughness != null
  ) {
    face.reverseStats = { power: reverse.power, toughness: reverse.toughness };
  }
  return {
    face,
    decision: Object.freeze({
      mode: "native",
      ...(scanBacked ? { reason: "scan-backed-layout" } : {}),
      layout,
      faceIndex: prepared.faceIndex,
      template: `card-glint:${scanBacked ? `${layout}-scan` : ["room", "planar", "scheme", "vanguard"].includes(layout) ? layout : (face.frameTemplate ?? (face.frameStyle === "retro" ? "retro" : faceFrame(face)))}`,
      engine: "card-glint",
    }),
  };
}
