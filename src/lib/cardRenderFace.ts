import {
  faceFrame,
  splitPanels,
  type RenderedCardInput,
  type FrameColor,
  type SecurityStamp,
  type CardTextInk,
  type TextInkSpan,
} from "card-glint/magic/presentation";
import type { SemanticCardInput } from "@/lib/cardSemanticLayout";
import type { CardFaceLiveChanges, CardFaceSnapshot, PreparedCard } from "@/lib/cardRenderSnapshot";
import { getTheme } from "@/hooks/useTheme";
import {
  CardRenderError,
  supportsRetroCardFrame,
  type CardRenderDecision,
} from "@/lib/cardRenderDecision";
import { resolveCardPrinting } from "@/lib/cardPrinting";
import { isTwoFaceLayout } from "@/lib/cardLayout";

export interface CardGlintFace {
  face: SemanticCardInput;
  decision: CardRenderDecision;
}

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

function resolveLiveChanges(changes: CardFaceLiveChanges, face: RenderedCardInput): CardTextInk {
  const colors = getTheme().gameTheme.cardChange;
  const tones: Record<NonNullable<CardFaceLiveChanges["power"]>, string> = {
    buffed: colors.buffed,
    debuffed: colors.debuffed,
    added: colors.buffed,
    changed: colors.changed,
  };
  const stats: TextInkSpan[] = [];
  if (face.power != null && face.toughness != null) {
    const slash = String(face.power).length;
    if (changes.power) stats.push({ start: 0, end: slash, color: tones[changes.power] });
    if (changes.toughness) stats.push({ start: slash + 1, color: tones[changes.toughness] });
  }
  let typeLine: TextInkSpan[] | undefined;
  if (changes.addedTypes) {
    const added = new Set(changes.addedTypes.map((word) => word.toLocaleLowerCase("en-US")));
    typeLine = added.size
      ? [...(face.typeLine ?? "").matchAll(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu)]
          .filter((match) => added.has(match[0].toLocaleLowerCase("en-US")))
          .map((match) => ({
            start: match.index,
            end: match.index + match[0].length,
            color: colors.buffed,
          }))
      : [{ start: 0, color: colors.removed }];
  }
  return { ...(stats.length ? { stats } : {}), ...(typeLine?.length ? { typeLine } : {}) };
}

export function cardGlintBaseline(
  prepared: PreparedCard,
  standardFrameFallback: boolean,
): CardGlintFace {
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
  const selectedPreset =
    prepared.cosmetics?.printing?.faces?.[prepared.faceIndex]?.preset ??
    prepared.cosmetics?.printing?.preset;
  const concretePreset = selectedPreset !== undefined && selectedPreset !== "match";
  const frameOverride =
    prepared.cosmetics?.frame === "modern" || prepared.cosmetics?.frame === "retro";
  const allowStandardFrame = standardFrameFallback || frameOverride || concretePreset;
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
    const painterLayout =
      isTwoFaceLayout(faceLayout) && !/\bBattle\b/i.test(canonicalType)
        ? faceLayout === "double_faced_token"
          ? "token"
          : "normal"
        : faceLayout;
    const colors = part.colors ??
      part.color_indicator ?? [...new Set(part.mana_cost.match(/[WUBRG]/g) ?? [])];
    const cosmetics = prepared.cosmetics;
    const preset = cosmetics?.printing?.faces?.[index]?.preset ?? cosmetics?.printing?.preset;
    const legacyFrame = preset && preset !== "match" ? undefined : cosmetics?.frame;
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
    if (legacyFrame === "retro" && !retroCompatible) original("incompatible-frame");
    const stamp = snapshot.security_stamp as SecurityStamp | undefined;
    const provider = prepared.printing[index]?.provider;
    const matchFrame = !legacyFrame || legacyFrame === "printing";
    const result: SemanticCardInput = {
      name: part.name,
      canonicalTypeLine: canonicalType,
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
        (legacyFrame === "modern" ||
          (cosmetics?.border != null && cosmetics.border !== "printing")),
      layout:
        semanticLayout === "saga" && layout === "transform"
          ? "transform"
          : (semanticLayout ?? painterLayout),
      frameStyle:
        legacyFrame === "modern"
          ? "modern"
          : retroCompatible &&
              (legacyFrame === "retro" ||
                (!fallbackTreatment && snapshot.frame && Number(snapshot.frame) < 2003))
            ? "retro"
            : "modern",
      borderColor: borderColor === "white" || borderColor === "silver" ? borderColor : "black",
      wordingMode: "oracle",
      symbolStyle: "modern",
      securityStamp: provider?.securityStamp ?? (stamp && STAMPS[stamp] === true ? stamp : "none"),
      securityStampEffect: "static",
      setCode: provider?.setCode ?? snapshot.set,
      rarity:
        snapshot.rarity && RARITIES[snapshot.rarity] === true
          ? (snapshot.rarity as RenderedCardInput["rarity"])
          : "common",
      artist: prepared.printing[index]?.artist ?? part.artist ?? snapshot.artist,
      collectorNumber: provider?.collectorNumber ?? snapshot.collector_number,
      collectorLanguage: provider?.collectorLanguage ?? snapshot.lang,
      ...(matchFrame && !fallbackTreatment && provider
        ? {
            frameStyle: provider.frameStyle,
            frameTemplate: provider.frameTemplate,
            frameAssetFamily: provider.frameAssetFamily,
            frameTreatment: provider.frameTreatment,
            futureTreatment: provider.futureTreatment,
            ...(provider.frameColors && !prepared.gameplay
              ? { frameColors: provider.frameColors }
              : {}),
            watermark: provider.watermark,
          }
        : {}),
    };
    if (part.liveChanges) result.textInk = resolveLiveChanges(part.liveChanges, result);
    if (faceLayout === "flip") result.frameTemplate = "flip";
    else if (/\bBattle\b/i.test(canonicalType)) result.frameTemplate = "battle";
    else if (
      !fallbackTreatment &&
      snapshot.frame === "future" &&
      (!legacyFrame || legacyFrame === "printing")
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
    if (
      (face.layout === "split" || face.layout === "aftermath") &&
      prepared.artUrls[0] === prepared.artUrls[1]
    ) {
      const panels = splitPanels({
        ...face,
        faces: face.faces.map((part) => ({ ...part, illustration: null })),
      });
      face.faces = face.faces.map((part, index) => ({
        ...part,
        illustrationCrop: panels[index]!.face.illustrationCrop,
      }));
    }
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

export function cardGlintFace(
  prepared: PreparedCard,
  standardFrameFallback: boolean,
): CardGlintFace {
  const { face: baseline, decision } = cardGlintBaseline(prepared, standardFrameFallback);
  const face = resolveCardPrinting(baseline, prepared);
  return {
    face,
    decision: Object.freeze({
      ...decision,
      template: `card-glint:${face.layout === "art_series" || face.layout === "front_card" ? `${face.layout}-scan` : ["room", "planar", "scheme", "vanguard"].includes(face.layout ?? "") ? face.layout : (face.frameTemplate ?? (face.frameStyle === "retro" ? "retro" : faceFrame(face)))}`,
    }),
  };
}
