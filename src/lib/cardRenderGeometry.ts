import {
  faceRects,
  faceFrame,
  extraRuleBlocks,
  CLASS_LEVEL_ASSET,
  splitPanels,
  panelRect,
  ADVENTURE_RULE_BOUNDS,
  PREPARE_SPELL_RECTS,
  FLIP_PANEL_RECTS,
  STANDARD_TEMPLATE_DEFAULTS,
  SAGA_CHAPTER,
  SAGA_MARKER_GEOMETRY,
  SAGA_RECTS,
  SAGA_RULE_BOUNDS,
  PLANESWALKER_COST_GEOMETRY,
  PLANESWALKER_RULE_GEOMETRY,
  planeswalkerInkLimits,
  ruleBadgeAsset,
  specialRules,
  FACE_WIDTH,
  FACE_HEIGHT,
  ordinaryTextLayout,
  retroTextLayout,
  rulesFont,
  resolveCardProfile,
  resolveFrameColors,
  type RenderedCardInput,
  visibleArt,
  type FaceRect,
} from "card-glint/magic/presentation";
import { isSemanticLayout, semanticLayoutRegions } from "@/lib/cardSemanticLayout";
import type { CardCanvas } from "@/lib/cardRenderTypes";

export const CARD_RENDER_WIDTH = 375;
export const CARD_RENDER_HEIGHT = 525;
const RULES_FONT_FAMILY = rulesFont(1).replace(/^1px\s+/, "");

export interface CardRenderRegion {
  readonly name: string;
  readonly role: "rules" | "stats" | "artwork" | "title" | "type";
  readonly faceIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly angle: number;
  readonly inkTone?: "dark" | "light";
  readonly fontFamily?: string;
}

export interface CardArtWindow {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
const artWindowsByCanvas = new WeakMap<CardCanvas, readonly CardArtWindow[]>();
const NO_ART_WINDOWS: readonly CardArtWindow[] = Object.freeze([]);
export function getCardArtWindows(canvas: CardCanvas): readonly CardArtWindow[] {
  return artWindowsByCanvas.get(canvas) ?? NO_ART_WINDOWS;
}

export interface CardInteractionPanel {
  readonly id: string;
  readonly faceIndex: number;
  readonly kind: "face" | "level";
  readonly region: CardRenderRegion;
  readonly exclusions: readonly CardRenderRegion[];
  readonly classLevelBand?: {
    readonly assetUrl: string;
    readonly height: number;
    readonly fontSize: number;
  };
  readonly sagaRail?: {
    readonly marker: {
      readonly shape: "chapter";
      readonly assetUrl: string;
      readonly x: number;
      readonly width: number;
      readonly height: number;
      readonly centerX: number;
      readonly numeralOffsetY: number;
      readonly gap: number;
      readonly fontSize: number;
      readonly fontFamily: string;
      readonly minimumRowHeight: number;
    };
    readonly text: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
    };
    readonly reminder: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
    };
  };
  readonly planeswalker?: {
    readonly badge: {
      readonly assets: Readonly<Record<"plus" | "zero" | "minus", string>>;
      readonly x: number;
      readonly width: number;
      readonly height: number;
      readonly fontSize: number;
      readonly fontFamily: string;
      readonly fontWeight: 700;
      readonly ink: string;
      readonly numeralOffsetX: number;
      readonly numeralOffsetY: Readonly<Record<"plus" | "zero" | "minus", number>>;
      readonly numeralMaxWidth: number;
      readonly numeralWidthScale: number;
    };
    readonly text: { readonly x: number; readonly width: number };
    readonly staticText: { readonly x: number; readonly width: number };
    readonly separator: { readonly x: number; readonly width: number; readonly height: number };
    readonly colon: {
      readonly x: number;
      readonly fontSize: number;
      readonly fontFamily: string;
      readonly offsetY: number;
      readonly ink: string;
    };
    readonly minimumRowHeight: number;
    readonly ink: { readonly top: number; readonly bottom: number };
  };
  readonly level?: {
    readonly rulesText: string;
    readonly range: string;
    readonly statsText: string;
  };
}

export interface CardRenderGeometry {
  readonly width: number;
  readonly height: number;
  readonly sourceOrientation: "portrait" | "landscape";
  readonly normalizationRotation: 0 | -90;
  readonly regions: readonly CardRenderRegion[];
  readonly rules: readonly CardRenderRegion[];
  readonly artwork: readonly CardRenderRegion[];
  readonly title: readonly CardRenderRegion[];
  readonly stats: readonly CardRenderRegion[];
  readonly panels: readonly CardInteractionPanel[];
  readonly rulesFontSize?: number;
}

const geometryByCanvas = new WeakMap<CardCanvas, CardRenderGeometry>();
const FALLBACK_PANELS: readonly CardInteractionPanel[] = Object.freeze([
  Object.freeze({
    id: "fallback",
    faceIndex: 0,
    kind: "face",
    region: Object.freeze({
      name: "rules_0",
      role: "rules",
      faceIndex: 0,
      x: 25,
      y: 340,
      width: 325,
      height: 160,
      angle: 0,
    }),
    exclusions: Object.freeze([]),
  }),
]);
const FALLBACK_LANDSCAPE_PANELS: readonly CardInteractionPanel[] = Object.freeze([
  Object.freeze({
    ...FALLBACK_PANELS[0]!,
    region: Object.freeze({
      ...FALLBACK_PANELS[0]!.region,
      x: 275,
      y: 77,
      width: 223,
      height: 260,
    }),
  }),
]);

export function orientCardRegion(region: CardRenderRegion, landscape: boolean): CardRenderRegion {
  return landscape
    ? {
        ...region,
        x: CARD_RENDER_HEIGHT - region.y - region.height,
        y: region.x,
        width: region.height,
        height: region.width,
        angle: (region.angle + 90) % 360,
      }
    : region;
}

function planeswalkerPanel(
  face: RenderedCardInput,
  region: CardRenderRegion,
): CardInteractionPanel["planeswalker"] {
  const frame = faceFrame(face);
  if (frame !== "planeswalker" && frame !== "planeswalker-large") return undefined;
  const rect = faceRects(face).rules;
  const nativeWidth = rect[2] * FACE_WIDTH;
  const scaleX = region.width / nativeWidth;
  const scaleY = region.height / (rect[3] * FACE_HEIGHT);
  const rules = PLANESWALKER_RULE_GEOMETRY;
  const cost = PLANESWALKER_COST_GEOMETRY;
  const [inkTop, inkBottom] = planeswalkerInkLimits(frame === "planeswalker-large");
  return Object.freeze({
    badge: Object.freeze({
      assets: Object.freeze({
        plus: ruleBadgeAsset(frame, "+1")!,
        zero: ruleBadgeAsset(frame, "0")!,
        minus: ruleBadgeAsset(frame, "−1")!,
      }),
      x: region.x,
      width: rules.badgeWidth * scaleX,
      height: rules.badgeHeight * scaleY,
      fontSize: cost.fontSize * scaleY,
      fontFamily: cost.fontFamily,
      fontWeight: cost.fontWeight,
      ink: cost.ink,
      numeralOffsetX: cost.numeralOffsetX * scaleX,
      numeralOffsetY: Object.freeze({
        plus: cost.numeralOffsetY.plus * scaleY,
        zero: cost.numeralOffsetY.zero * scaleY,
        minus: cost.numeralOffsetY.minus * scaleY,
      }),
      numeralMaxWidth: (rules.badgeWidth - cost.horizontalInset) * scaleX,
      numeralWidthScale: cost.widthScale,
    }),
    text: Object.freeze({
      x: region.x + rules.textLeft * scaleX,
      width: (nativeWidth - rules.textLeft - rules.rightInset) * scaleX,
    }),
    staticText: Object.freeze({
      x: region.x + rules.staticTextLeft * scaleX,
      width: (nativeWidth - rules.staticTextLeft - rules.rightInset) * scaleX,
    }),
    separator: Object.freeze({
      x: region.x + rules.separatorLeft * scaleX,
      width: (nativeWidth - rules.separatorLeft) * scaleX,
      height: rules.separatorHeight * scaleY,
    }),
    colon: Object.freeze({
      x: region.x + (rules.badgeWidth + rules.colonOffsetX) * scaleX,
      fontSize: rules.colonFontSize * scaleY,
      fontFamily: rules.colonFontFamily,
      offsetY: rules.colonOffsetY * scaleY,
      ink: rules.colonInk,
    }),
    minimumRowHeight: rules.minimumRowHeight * scaleY,
    ink: Object.freeze({
      top: region.y + (inkTop - rect[1] * FACE_HEIGHT) * scaleY,
      bottom: region.y + (inkBottom - rect[1] * FACE_HEIGHT) * scaleY,
    }),
  });
}

export function attachCardRenderGeometry(
  canvas: CardCanvas,
  face: RenderedCardInput,
  selectedFaceIndex: number,
): void {
  const panels = splitPanels(face);
  const regions: CardRenderRegion[] = [];
  const leveler = faceFrame(face) === "leveler";
  const levelBlocks = leveler ? extraRuleBlocks(face) : [];
  const classBlocks = faceFrame(face) === "class" ? extraRuleBlocks(face) : [];
  const classBand = classBlocks.find((block) => block.asset === CLASS_LEVEL_ASSET);
  const classLevelBand = classBand
    ? Object.freeze({
        assetUrl: CLASS_LEVEL_ASSET,
        height: (classBand.height / FACE_HEIGHT) * CARD_RENDER_HEIGHT,
        fontSize:
          (classBlocks.find((block) => block.kind === "heading")!.font / FACE_HEIGHT) *
          CARD_RENDER_HEIGHT,
      })
    : undefined;
  const sagaRail: CardInteractionPanel["sagaRail"] =
    faceRects(face) === SAGA_RECTS
      ? Object.freeze({
          marker: Object.freeze({
            shape: SAGA_MARKER_GEOMETRY.shape,
            assetUrl: SAGA_CHAPTER,
            x: (SAGA_MARKER_GEOMETRY.x / FACE_WIDTH) * CARD_RENDER_WIDTH,
            width: (SAGA_MARKER_GEOMETRY.width / FACE_WIDTH) * CARD_RENDER_WIDTH,
            height: (SAGA_MARKER_GEOMETRY.height / FACE_HEIGHT) * CARD_RENDER_HEIGHT,
            centerX: (SAGA_MARKER_GEOMETRY.centerX / FACE_WIDTH) * CARD_RENDER_WIDTH,
            numeralOffsetY:
              (SAGA_MARKER_GEOMETRY.numeralOffsetY / FACE_HEIGHT) * CARD_RENDER_HEIGHT,
            gap: (SAGA_MARKER_GEOMETRY.gap / FACE_HEIGHT) * CARD_RENDER_HEIGHT,
            fontSize: (SAGA_MARKER_GEOMETRY.fontSize / FACE_HEIGHT) * CARD_RENDER_HEIGHT,
            fontFamily: SAGA_MARKER_GEOMETRY.fontFamily,
            minimumRowHeight:
              (SAGA_MARKER_GEOMETRY.minimumRowHeight / FACE_HEIGHT) * CARD_RENDER_HEIGHT,
          }),
          text: Object.freeze({
            x: (SAGA_RULE_BOUNDS.chapters.x / FACE_WIDTH) * CARD_RENDER_WIDTH,
            y:
              ((specialRules(face).some((row) => !row.badges.length)
                ? SAGA_RULE_BOUNDS.reminderBottom
                : SAGA_RULE_BOUNDS.top) /
                FACE_HEIGHT) *
              CARD_RENDER_HEIGHT,
            width: (SAGA_RULE_BOUNDS.chapters.width / FACE_WIDTH) * CARD_RENDER_WIDTH,
          }),
          reminder: Object.freeze({
            x: (SAGA_RULE_BOUNDS.reminder.x / FACE_WIDTH) * CARD_RENDER_WIDTH,
            y: (SAGA_RULE_BOUNDS.reminder.y / FACE_HEIGHT) * CARD_RENDER_HEIGHT,
            width: (SAGA_RULE_BOUNDS.reminder.width / FACE_WIDTH) * CARD_RENDER_WIDTH,
          }),
        })
      : undefined;
  const levelContent = new Map<string, NonNullable<CardInteractionPanel["level"]>>();
  const palette = resolveFrameColors(face);
  const inkTone =
    face.frameTemplate === "future" &&
    resolveCardProfile(face).land &&
    palette.length === 2 &&
    !palette.includes("W")
      ? "light"
      : "dark";
  const add = (
    name: string,
    role: CardRenderRegion["role"],
    rect: FaceRect,
    angle: number,
    faceIndex: number,
  ) => {
    const [x, y, width, height] = rect;
    regions.push(
      Object.freeze({
        name,
        role,
        faceIndex,
        x: x * CARD_RENDER_WIDTH,
        y: y * CARD_RENDER_HEIGHT,
        width: width * CARD_RENDER_WIDTH,
        height: height * CARD_RENDER_HEIGHT,
        angle,
        ...(role === "rules" ? { inkTone, fontFamily: RULES_FONT_FAMILY } : {}),
      }),
    );
  };
  const append = (
    part: RenderedCardInput,
    index: number,
    transform: (rect: FaceRect) => FaceRect,
    angle: number,
  ) => {
    const rects = faceRects(part);
    for (const [key, role] of [
      ["rules", "rules"],
      ["stats", "stats"],
      ["art", "artwork"],
      ["title", "title"],
      ["type", "type"],
    ] as const) {
      if (face.frameTemplate === "flip" && key !== "art") continue;
      if (key === "rules" && face.layout === "adventure") continue;
      if (leveler && (key === "rules" || key === "stats")) continue;
      if (key === "stats" && part.power == null && part.loyalty == null && part.defense == null)
        continue;
      add(
        `${key}_${index}`,
        role,
        transform(key === "art" ? visibleArt(part) : rects[key]),
        angle,
        index,
      );
    }
  };
  if (isSemanticLayout(face))
    semanticLayoutRegions(face).forEach((region) =>
      add(
        region.name,
        region.role,
        region.rect,
        region.angle,
        region.faceIndex + selectedFaceIndex,
      ),
    );
  else if (panels.length)
    panels.forEach((panel, index) =>
      append(panel.face, index, (rect) => panelRect(panel, rect), (panel.rotation + 360) % 360),
    );
  else append(face, selectedFaceIndex, (rect) => rect, face.frameTemplate === "battle" ? 270 : 0);
  if (face.frameTemplate === "flip") {
    const [width, height] = STANDARD_TEMPLATE_DEFAULTS.flip.size;
    FLIP_PANEL_RECTS.forEach((rects, index) => {
      for (const key of ["rules", "stats", "title", "type"] as const) {
        if (key === "stats" && face.faces?.[index]?.power == null) continue;
        const [x, y, w, h] = rects[key];
        add(
          `${key}_${index}`,
          key,
          index === 0
            ? [x / width, y / height, w / width, h / height]
            : [1 - (x + w) / width, 1 - (y + h) / height, w / width, h / height],
          index * 180,
          index,
        );
      }
    });
  }
  if (face.layout === "adventure") {
    Object.values(ADVENTURE_RULE_BOUNDS).forEach(({ x, y, width, height }, index) =>
      add(
        `rules_${index}`,
        "rules",
        [x / FACE_WIDTH, y / FACE_HEIGHT, width / FACE_WIDTH, height / FACE_HEIGHT],
        0,
        index,
      ),
    );
  }
  if (face.layout === "prepare") {
    for (const key of ["rules", "title", "type"] as const)
      add(`${key}_1`, key, PREPARE_SPELL_RECTS[key], 0, 1);
  }
  if (leveler) {
    levelBlocks.forEach((block, index) => {
      if (block.kind !== "rules" && block.kind !== "stats") return;
      add(
        `${block.kind}_${index}`,
        block.kind,
        [
          block.x / FACE_WIDTH,
          block.y / FACE_HEIGHT,
          block.width / FACE_WIDTH,
          block.height / FACE_HEIGHT,
        ],
        0,
        selectedFaceIndex,
      );
      if (block.kind === "rules") {
        const band = levelBlocks.slice(index + 1).findIndex((next) => next.kind === "rules");
        const fields = levelBlocks.slice(index + 1, band < 0 ? undefined : index + 1 + band);
        levelContent.set(`rules_${index}`, {
          rulesText: block.text,
          range: fields.find((field) => field.kind === "level")?.text.replace(/^LEVEL\n/, "") ?? "",
          statsText: fields.find((field) => field.kind === "stats")?.text ?? "",
        });
      }
    });
  }
  const rules = Object.freeze(regions.filter((region) => region.role === "rules"));
  const stats = Object.freeze(regions.filter((region) => region.role === "stats"));
  const artwork = Object.freeze(regions.filter((region) => region.role === "artwork"));
  const interactionPanels = Object.freeze(
    rules.map((region) => {
      const level = levelContent.get(region.name);
      const planeswalker = !isSemanticLayout(face)
        ? planeswalkerPanel(panels[region.faceIndex]?.face ?? face, region)
        : undefined;
      return Object.freeze({
        id: region.name,
        faceIndex: region.faceIndex,
        kind: level ? ("level" as const) : ("face" as const),
        region,
        exclusions: Object.freeze(
          stats.filter(
            (stat) =>
              stat.faceIndex === region.faceIndex &&
              stat.x < region.x + region.width &&
              stat.x + stat.width > region.x &&
              stat.y < region.y + region.height &&
              stat.y + stat.height > region.y,
          ),
        ),
        ...(level ? { level } : {}),
        ...(sagaRail && region.faceIndex === selectedFaceIndex ? { sagaRail } : {}),
        ...(classLevelBand && region.faceIndex === selectedFaceIndex ? { classLevelBand } : {}),
        ...(planeswalker ? { planeswalker } : {}),
      });
    }),
  );
  artWindowsByCanvas.set(
    canvas,
    Object.freeze(
      artwork.map((region) =>
        Object.freeze({
          x: region.x / CARD_RENDER_WIDTH,
          y: region.y / CARD_RENDER_HEIGHT,
          width: region.width / CARD_RENDER_WIDTH,
          height: region.height / CARD_RENDER_HEIGHT,
        }),
      ),
    ),
  );
  geometryByCanvas.set(
    canvas,
    Object.freeze({
      width: CARD_RENDER_WIDTH,
      height: CARD_RENDER_HEIGHT,
      sourceOrientation:
        face.frameTemplate === "battle" || face.layout === "room" || face.layout === "planar"
          ? "landscape"
          : "portrait",
      normalizationRotation:
        face.frameTemplate === "battle" || face.layout === "room" || face.layout === "planar"
          ? -90
          : 0,
      regions: Object.freeze(regions),
      rules,
      artwork,
      title: Object.freeze(regions.filter((region) => region.role === "title")),
      stats,
      panels: interactionPanels,
      rulesFontSize: paintedRulesFontSize(face, interactionPanels),
    }),
  );
}

let measuringContext: CanvasRenderingContext2D | null = null;

function paintedRulesFontSize(
  face: RenderedCardInput,
  panels: readonly CardInteractionPanel[],
): number | undefined {
  const [panel] = panels;
  if (
    panels.length !== 1 ||
    isSemanticLayout(face) ||
    panel!.kind !== "face" ||
    panel!.planeswalker ||
    panel!.sagaRail ||
    panel!.classLevelBand
  )
    return undefined;
  measuringContext ??= document.createElement("canvas").getContext("2d");
  if (!measuringContext) throw new Error("Card rendering requires a 2D canvas context");
  const layout =
    retroTextLayout(measuringContext, face) ?? ordinaryTextLayout(measuringContext, face);
  return (layout.size * CARD_RENDER_WIDTH) / FACE_WIDTH;
}

export function getCardRenderGeometry(canvas: CardCanvas): CardRenderGeometry | undefined {
  return geometryByCanvas.get(canvas);
}

export function getCardInteractionPanels(
  geometry: CardRenderGeometry | undefined,
  landscape: boolean,
): readonly CardInteractionPanel[] {
  if (!geometry) return landscape ? FALLBACK_LANDSCAPE_PANELS : FALLBACK_PANELS;
  const panels = geometry.panels;
  return landscape
    ? panels.map((panel) => ({
        ...panel,
        region: orientCardRegion(panel.region, true),
        exclusions: panel.exclusions.map((region) => orientCardRegion(region, true)),
      }))
    : panels;
}
