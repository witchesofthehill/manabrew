import {
  faceFrame,
  splitPanels,
  type RenderedCardInput,
  type FrameColor,
  type SecurityStamp,
  type CardTextInk,
  type TextInkSpan,
} from "card-glint/magic/presentation";
import { isSemanticLayout, type SemanticCardInput } from "@/lib/cardSemanticLayout";
import type { CardFaceLiveChanges, CardFaceSnapshot, PreparedCard } from "@/lib/cardRenderSnapshot";
import { getTheme } from "@/hooks/useTheme";
import {
  CardRenderError,
  supportsRetroCardFrame,
  type CardRenderDecision,
} from "@/lib/cardRenderDecision";
import { resolveCardPrinting } from "@/lib/cardPrinting";
import { isTwoFaceLayout } from "@/lib/cardLayout";
import { prototypeRules } from "@/lib/cardPrototype";

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
  case: true,
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
  prototype: true,
  mutate: true,
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

function renderDecision(
  face: SemanticCardInput,
  layout: string,
  faceIndex: number,
): CardRenderDecision {
  const semantic = isSemanticLayout(face);
  const scanBacked = face.layout === "art_series" || face.layout === "front_card";
  return Object.freeze({
    mode: semantic ? "host" : "native",
    ...(scanBacked
      ? { reason: "scan-backed-layout" }
      : semantic
        ? { reason: "host-owned-semantic-composition" }
        : {}),
    layout: face.layout === "prototype" || face.layout === "aftermath" ? face.layout : layout,
    faceIndex,
    template: scanBacked
      ? `manabrew-scan:${face.layout}`
      : semantic
        ? `manabrew-semantic:${face.layout}`
        : `card-glint:${face.frameTemplate ?? (face.layout === "split" || face.layout === "aftermath" ? face.layout : face.frameStyle === "retro" ? "retro" : faceFrame(face))}`,
    engine: semantic ? "manabrew" : "card-glint",
  });
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
          : part.levelerRules !== undefined || /^Level up\b/m.test(part.oracle_text)
            ? "leveler"
            : undefined;
    const faceLayout = part.layout ?? (child ? "normal" : layout);
    if (SUPPORTED_LAYOUTS[faceLayout] !== true) original("unknown-layout");
    const painterLayout =
      faceLayout === "mutate"
        ? "normal"
        : isTwoFaceLayout(faceLayout) && !/\bBattle\b/i.test(canonicalType)
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
      rulesText: part.levelerRules ?? part.oracle_text,
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
      power: part.levelerBase?.power ?? part.power,
      toughness: part.levelerBase?.toughness ?? part.toughness,
      loyalty: part.loyalty,
      defense: part.defense,
      handModifier: part.hand_modifier,
      lifeModifier: part.life_modifier,
      sourceFrame: faceLayout === "vanguard" ? snapshot.frame : undefined,
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
    if (part.prototype) {
      const prototype = part.prototype;
      const selected = part.prototypeSelected === true;
      const base = part.prototypeBase;
      const printedRules = part.prototypeRules ?? original("unrepresentable-fields");
      const currentRules = prototypeRules(part.oracle_text, prototype);
      if (!currentRules && /\/\/PRT-/.test(part.oracle_text)) original("unrepresentable-fields");
      const normal = {
        ...result,
        layout: "normal",
        manaSymbols:
          part.prototypeSelected !== false && base
            ? [...base.manaCost.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]!)
            : result.manaSymbols,
        colors:
          part.prototypeSelected !== false && base
            ? frameColors(base.manaCost.match(/[WUBRG]/g) ?? [])
            : result.colors,
        power: part.prototypeSelected !== false && base ? base.power : result.power,
        toughness: part.prototypeSelected !== false && base ? base.toughness : result.toughness,
        rulesText: currentRules?.rulesText ?? part.oracle_text,
        rulesParagraphs: undefined,
        textInk: result.textInk
          ? {
              ...result.textInk,
              stats: part.prototypeSelected === false ? result.textInk.stats : undefined,
            }
          : undefined,
      };
      const alternate = {
        ...result,
        name: printedRules.name,
        layout: "normal",
        manaSymbols: selected
          ? result.manaSymbols
          : [...prototype.manaCost.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]!),
        colors: frameColors(prototype.manaCost.match(/[WUBRG]/g) ?? []),
        frameColors: undefined,
        power: selected ? result.power : prototype.power,
        toughness: selected ? result.toughness : prototype.toughness,
        rulesText: printedRules.reminder,
        rulesParagraphs: undefined,
        textInk: selected && result.textInk?.stats ? { stats: result.textInk.stats } : undefined,
      };
      result.layout = "prototype";
      result.faces = [normal, alternate];
    }
    if (part.levelerRules && result.textInk)
      result.textInk = { ...result.textInk, stats: undefined };
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
    face.layout = layout === "room" ? "split" : layout;
    if (prepared.composite && !fallbackTreatment) {
      const provider = prepared.composite;
      Object.assign(face, {
        layout: provider.layout ?? face.layout,
        frameStyle: frameOverride && !concretePreset ? face.frameStyle : provider.frameStyle,
        frameTemplate: provider.frameTemplate,
        frameAssetFamily:
          frameOverride && !concretePreset ? face.frameAssetFamily : provider.frameAssetFamily,
        frameTreatment: provider.frameTreatment,
        futureTreatment: provider.futureTreatment,
      });
    }
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
  if (isSemanticLayout(face)) {
    face.frameAssetFamily = undefined;
    face.frameTemplate = undefined;
    face.frameTreatment = undefined;
    face.futureTreatment = undefined;
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
    decision: renderDecision(face, layout, prepared.faceIndex),
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
    decision: renderDecision(face, decision.layout, decision.faceIndex),
  };
}
