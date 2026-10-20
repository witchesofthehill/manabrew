import type { CardDocument, Raster, RasterHost } from "card-glint";
import {
  closeRaster,
  rasterCanvas,
  type CanvasContext,
  type CanvasRaster,
} from "card-glint/canvas";
import { opticalDocument } from "card-glint/magic";
import {
  cardStock,
  cardTextureSize,
  composeCardTexture,
  faceStats,
  faceRects,
  framePlate,
  profileAssets,
  resolveCardProfile,
  faceFrame,
  canvasAssetUrls,
  paintAssembledFace,
  FACE_WIDTH,
  FACE_HEIGHT,
  FACE_CORNER_RADIUS,
  canvasAssetWidth,
  type TextureTier,
  loadCanvasImages,
  type CanvasFontAsset,
  faceManaAssets,
  paintFittedText,
  paintMana,
  layoutRules,
  paintRulesLayout,
  type FaceRect,
  type RenderedCardInput,
  type CanvasImages,
  type RulesParagraph,
  type RulesRun,
} from "card-glint/magic/presentation";
import { ensureCardGlintFont, ensureCardGlintFonts } from "@/lib/cardGlintAssets";
import {
  semanticFrame,
  semanticFrameAssets,
  frameRect,
  paintSemanticFrame,
  prototypeFrameAssets,
  paintPrototypeFrame,
  VANGUARD_FONT_ASSET,
} from "@/lib/cardSemanticFrames";

export interface SemanticCardInput extends RenderedCardInput {
  handModifier?: string;
  lifeModifier?: string;
  scanBorder?: boolean;
  sourceFrame?: string;
  faces?: SemanticCardInput[];
}
type Role = "rules" | "stats" | "artwork" | "title" | "type";
interface Region {
  role: Role;
  rect: FaceRect;
  faceIndex: number;
}
const MIN_RULES_FONT_SIZE = 7;
const RULES_FONT_SIZE_STEP = 0.25;
const LAYOUTS: Record<string, true> = {
  prototype: true,
  planar: true,
  scheme: true,
  vanguard: true,
  art_series: true,
  front_card: true,
};
export function isSemanticLayout(face: RenderedCardInput): boolean {
  return LAYOUTS[face.layout ?? ""] === true;
}
function scanBacked(face: RenderedCardInput): boolean {
  return face.layout === "art_series" || face.layout === "front_card";
}
function parts(face: SemanticCardInput): SemanticCardInput[] {
  if (face.layout !== "prototype") return [face];
  if (face.faces?.length !== 2) throw Error("Prototype composition requires both parts.");
  return face.faces;
}
export function semanticCardAssetUrls(face: SemanticCardInput): (string | null | undefined)[] {
  const faces = parts(face);
  const assets = faces.flatMap((part) => [part.illustration, ...faceManaAssets(part)]);
  if (scanBacked(face)) return assets;
  return [
    ...assets,
    ...(face.layout === "prototype"
      ? [...canvasAssetUrls(faces[0]!), ...prototypeFrameAssets(faces[1]!)]
      : semanticFrameAssets(semanticFrame(face))),
  ];
}
function prototypeRect(rect: FaceRect): FaceRect {
  return [
    (rect[0] / 375) * FACE_WIDTH,
    (rect[1] / 523) * FACE_HEIGHT,
    (rect[2] / 375) * FACE_WIDTH,
    (rect[3] / 523) * FACE_HEIGHT,
  ];
}
function regions(face: SemanticCardInput): Region[] {
  if (scanBacked(face))
    return [
      {
        role: "artwork",
        rect: face.scanBorder
          ? [12, 12, FACE_WIDTH - 24, FACE_HEIGHT - 24]
          : [0, 0, FACE_WIDTH, FACE_HEIGHT],
        faceIndex: 0,
      },
    ];
  const result: Region[] = [];
  const add = (role: Role, rect: FaceRect, faceIndex = 0) => result.push({ role, rect, faceIndex });
  if (face.layout === "prototype") {
    const [normal, alternate] = parts(face);
    const rects = framePlate(normal!)?.rects ?? faceRects(normal!);
    const pixels = (rect: FaceRect): FaceRect => [
      rect[0] * FACE_WIDTH,
      rect[1] * FACE_HEIGHT,
      rect[2] * FACE_WIDTH,
      rect[3] * FACE_HEIGHT,
    ];
    add("title", pixels(rects.title));
    add("artwork", pixels(rects.art));
    add("type", pixels(rects.type));
    const manaWidth = Math.max(30, (alternate!.manaSymbols?.length ?? 0) * 14);
    add("title", prototypeRect([343 - manaWidth, 332, manaWidth, 20]), 1);
    add("rules", prototypeRect([29, 329, 261, 53]), 1);
    add("stats", prototypeRect([300, 360, 45, 21]), 1);
    add("rules", prototypeRect([29, 390, 313, 91]));
    if (faceStats(normal!)) add("stats", pixels(rects.stats));
  } else {
    const frame = semanticFrame(face);
    const rect = (value: FaceRect) => frameRect(frame, value, face.layout === "planar");
    add("title", rect(frame.title));
    add("artwork", rect(frame.art));
    add("type", rect(frame.type));
    add("rules", rect(frame.rules));
    if (frame.hand) add("stats", rect(frame.hand));
    if (frame.life) add("stats", rect(frame.life));
  }
  return result;
}
export interface SemanticLayoutRegion {
  name: string;
  role: Role;
  rect: FaceRect;
  angle: number;
  faceIndex: number;
}
export function semanticLayoutRegions(face: SemanticCardInput): readonly SemanticLayoutRegion[] {
  const sideways = face.layout === "planar";
  const names = new Map<string, number>();
  return regions(face).map(({ role, rect: [x, y, w, h], faceIndex }) => {
    const key = `${role}_${faceIndex}`;
    const occurrence = names.get(key) ?? 0;
    names.set(key, occurrence + 1);
    return {
      name: occurrence ? `${key}_${occurrence}` : key,
      role,
      faceIndex,
      rect: (sideways
        ? [y / FACE_WIDTH, 1 - (x + w) / FACE_HEIGHT, h / FACE_WIDTH, w / FACE_HEIGHT]
        : [x / FACE_WIDTH, y / FACE_HEIGHT, w / FACE_WIDTH, h / FACE_HEIGHT]) as FaceRect,
      angle: sideways ? 270 : 0,
    };
  });
}
function paragraphs(face: RenderedCardInput): readonly RulesParagraph[] {
  return (
    face.rulesParagraphs ??
    (face.rulesText ?? "")
      .split("\n")
      .filter(Boolean)
      .map((text) => ({ role: "rules" as const, runs: [{ text }] }))
  );
}
const rulesWordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });

function wordWrappedRules(
  c: CanvasContext,
  values: readonly RulesParagraph[],
  width: number,
  height: number,
  size: number,
): RulesParagraph[] {
  return values.map((paragraph) => {
    const chunks: RulesRun[][] = [];
    for (const run of paragraph.runs) {
      for (const part of run.text.split(/(\{[^}\n]+\}|\n)/g).filter(Boolean)) {
        const pieces =
          part === "\n" || /^\{[^}\n]+\}$/.test(part)
            ? [part]
            : Array.from(rulesWordSegmenter.segment(part), ({ segment }) => segment);
        for (const text of pieces) {
          const previous = chunks.at(-1);
          const piece = { text, italic: run.italic };
          if (
            text !== "\n" &&
            previous?.[0]?.text !== "\n" &&
            previous &&
            (/^[\p{Pe}\p{Pf}\p{Po}]/u.test(text) || /[\p{Ps}\p{Pi}]$/u.test(previous.at(-1)!.text))
          ) {
            previous.push(piece);
          } else {
            chunks.push([piece]);
          }
        }
      }
    }
    const runs: RulesRun[] = [];
    let line: RulesRun[] = [];
    for (const chunk of chunks) {
      if (chunk[0]!.text === "\n") {
        runs.push(...chunk);
        line = [];
        continue;
      }
      const trial = layoutRules(
        c,
        [{ role: paragraph.role, runs: [...line, ...chunk] }],
        { x: 0, y: 0, width, height },
        size,
        size,
      );
      if (line.length && (trial.overflow || trial.lines.length > 1)) {
        runs.push({ text: "\n" });
        line = [];
      }
      runs.push(...chunk);
      line.push(...chunk);
    }
    return { ...paragraph, runs };
  });
}

function paintRules(
  c: CanvasContext,
  values: readonly RulesParagraph[],
  [x, y, width, height]: FaceRect,
  size: number,
  images: CanvasImages,
): void {
  let layout = layoutRules(c, values, { x, y, width, height }, size, MIN_RULES_FONT_SIZE);
  if (layout.overflow) {
    for (
      let candidate = size;
      candidate >= MIN_RULES_FONT_SIZE;
      candidate -= RULES_FONT_SIZE_STEP
    ) {
      const wrapped = wordWrappedRules(c, values, width, height, candidate);
      layout = layoutRules(c, wrapped, { x, y, width, height }, candidate, candidate);
      if (!layout.overflow) break;
    }
  }
  paintRulesLayout(c, layout, images);
}
function paintPrototype(
  c: CanvasContext,
  face: SemanticCardInput,
  images: CanvasImages,
  rulesText: boolean,
  palette: CardSemanticPalette,
  layer?: "artwork" | "printing",
): void {
  const [normal, alternate] = parts(face);
  const plate = framePlate(normal!);
  const components = profileAssets(resolveCardProfile(normal!), faceFrame(normal!));
  const required = plate
    ? [plate.frame, plate.rightFrame, faceStats(normal!) ? plate.pt : undefined]
    : [components.background, components.frame, components.boxes];
  for (const url of required)
    if (url && !images.has(url)) throw new Error(`Prototype frame resource is unavailable: ${url}`);
  paintAssembledFace(
    c,
    { ...normal!, rulesText: "", rulesParagraphs: [] },
    images,
    FACE_HEIGHT,
    false,
    undefined,
    layer,
  );
  if (layer === "artwork") return;
  paintPrototypeFrame(c, alternate!, images);
  const drawn = regions(face);
  const mana = drawn.find((region) => region.role === "title" && region.faceIndex === 1)!;
  const [x, y, w, h] = mana.rect;
  const symbols = alternate!.manaSymbols ?? [];
  const size = (13 / 375) * FACE_WIDTH;
  symbols.forEach((symbol, i) =>
    paintMana(
      c,
      symbol,
      x + w - symbols.length * (size + 1) + i * (size + 1),
      y + (h - size) / 2,
      size,
      images,
    ),
  );
  c.fillStyle = palette.ink;
  c.textBaseline = "middle";
  c.textAlign = "center";
  const stats = drawn.find((region) => region.role === "stats" && region.faceIndex === 1)!;
  paintFittedText(
    c,
    faceStats(alternate!)?.text ?? "",
    stats.rect[0] + stats.rect[2] / 2,
    stats.rect[1] + stats.rect[3] / 2,
    stats.rect[2],
    19,
    true,
    1,
    "CardRenderer MTG Beleren",
    0,
    alternate!.textInk,
    "stats",
  );
  if (!rulesText) return;
  const panel = drawn.find((region) => region.role === "rules" && region.faceIndex === 1)!;
  paintRules(
    c,
    [
      {
        role: "rules",
        runs: [{ text: alternate!.name }, { text: ` ${alternate!.rulesText ?? ""}`, italic: true }],
      },
    ],
    panel.rect,
    15,
    images,
  );
  const rules = drawn.find((region) => region.role === "rules" && region.faceIndex === 0)!;
  paintRules(c, paragraphs(normal!), rules.rect, 15, images);
}
function paintFrameLabel(
  c: CanvasContext,
  text: string,
  [x, y, width, height]: FaceRect,
  size: number,
  family: string,
  bold = true,
  ink?: RenderedCardInput["textInk"],
  left = false,
): void {
  c.textAlign = left ? "left" : "center";
  if (family === "CardRenderer MTG Beleren" || family === "CardRenderer MTG MPlantin") {
    paintFittedText(
      c,
      text,
      x + (left ? 0 : width / 2),
      y + height / 2,
      width,
      size,
      bold,
      1,
      family,
      0,
      ink,
    );
    return;
  }
  c.save();
  c.textAlign = "left";
  c.font = `${bold ? "bold " : ""}${size}px "${family}"`;
  size *= Math.min(1, width / c.measureText(text).width);
  c.font = `${bold ? "bold " : ""}${size}px "${family}"`;
  const metrics = c.measureText(text);
  const origin = x + (left ? 0 : (width - metrics.width) / 2);
  const baseline = y + height / 2;
  const inkLeft = origin - metrics.actualBoundingBoxLeft;
  const inkRight = origin + metrics.actualBoundingBoxRight;
  const top = baseline - metrics.actualBoundingBoxAscent;
  const inkHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
  const ranges = (ink?.typeLine ?? []).map((span) => ({
    left: span.start === 0 ? inkLeft : origin + c.measureText(text.slice(0, span.start)).width,
    right:
      span.end == null || span.end === text.length
        ? inkRight
        : origin + c.measureText(text.slice(0, span.end)).width,
    color: span.color,
  }));
  c.save();
  for (const range of ranges) {
    c.beginPath();
    c.rect(inkLeft, top, inkRight - inkLeft, inkHeight);
    c.rect(range.left, top, range.right - range.left, inkHeight);
    c.clip("evenodd");
  }
  c.fillText(text, origin, baseline);
  c.restore();
  if (!ink?.omitInk)
    for (const range of ranges) {
      c.save();
      c.beginPath();
      c.rect(range.left, top, range.right - range.left, inkHeight);
      c.clip();
      c.fillStyle = range.color;
      c.fillText(text, origin, baseline);
      c.restore();
    }
  c.restore();
}

function paintSpecialText(
  c: CanvasContext,
  face: SemanticCardInput,
  images: CanvasImages,
  rulesText: boolean,
  palette: CardSemanticPalette,
): void {
  const frame = semanticFrame(face);
  c.fillStyle = palette.ink;
  c.textBaseline = "middle";
  const titleFont =
    frame.vanguard === "paper"
      ? VANGUARD_FONT_ASSET.family
      : frame.vanguard === "mtgo_old"
        ? "Arial"
        : "CardRenderer MTG Beleren";
  const centered = (text: string, rect: FaceRect, size: number, font = titleFont) =>
    paintFrameLabel(c, text, rect, size, font);
  const left = frame.vanguard === "mtgo_new";
  paintFrameLabel(c, face.name, frame.title, frame.titleSize, titleFont, true, undefined, left);
  paintFrameLabel(
    c,
    face.typeLine ?? "",
    frame.type,
    frame.typeSize,
    titleFont,
    false,
    face.textInk,
    left,
  );
  if (frame.hand && frame.life) {
    const size = frame.vanguard === "mtgo_new" ? 35 : frame.vanguard === "paper" ? 25 : 20;
    centered(face.handModifier!, frame.hand, size);
    centered(face.lifeModifier!, frame.life, size);
    if (frame.flavor) {
      centered("Starting & Max.", [80, 809, 51, 18], 10.5, "CardRenderer MTG MPlantin");
      centered("Hand Size", [80, 827, 51, 18], 10.5, "CardRenderer MTG MPlantin");
      centered("Starting Life", [612, 809, 51, 36], 10.5, "CardRenderer MTG MPlantin");
    } else if (frame.vanguard === "mtgo_old") {
      centered("Hand", [102, 901, 74, 41], 20);
      centered("Life", [572, 901, 73, 41], 20);
    }
  }
  if (rulesText) {
    const values = paragraphs(face);
    paintRules(
      c,
      frame.flavor ? values.filter((part) => part.role !== "flavor") : values,
      frame.rules,
      frame.rulesSize,
      images,
    );
    if (frame.flavor)
      paintRules(
        c,
        values.filter((part) => part.role === "flavor"),
        frame.flavor,
        frame.rulesSize,
        images,
      );
  }
  c.fillStyle = palette.footer;
  c.textAlign = "left";
  const footer = [face.collectorNumber, face.rarity, face.setCode?.toUpperCase(), face.artist]
    .filter(Boolean)
    .join(" · ");
  paintFittedText(
    c,
    footer,
    frame.size[0] * 0.1,
    frame.size[1] - 24,
    frame.size[0] * 0.8,
    12,
    false,
    1,
    "CardRenderer MTG MPlantin",
  );
}
export interface SemanticImageLease {
  images: CanvasImages;
  dispose(): void;
}
export interface CardSemanticPalette {
  readonly ink: string;
  readonly footer: string;
}
export interface SemanticCompositionOptions {
  palette: CardSemanticPalette;
  rulesText?: boolean;
  paintLayer?: "artwork" | "printing";
  loadImages?: (
    urls: readonly (string | null | undefined)[],
    signal: AbortSignal,
  ) => Promise<SemanticImageLease>;
  loadFonts?: () => Promise<void>;
  loadFont?: (asset: CanvasFontAsset) => Promise<void>;
}
function finishSemanticCanvas(canvas: CanvasRaster): HTMLCanvasElement | ImageBitmap {
  if (typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas) {
    try {
      return canvas.transferToImageBitmap();
    } finally {
      closeRaster(canvas);
    }
  }
  return canvas as HTMLCanvasElement;
}
export async function composeSemanticCardTexture(
  face: SemanticCardInput,
  tier: TextureTier,
  signal: AbortSignal,
  options: SemanticCompositionOptions,
): Promise<HTMLCanvasElement | ImageBitmap> {
  if (!isSemanticLayout(face)) throw Error("Not a semantic card layout.");
  if (face.layout === "vanguard" && (face.handModifier == null || face.lifeModifier == null))
    throw Error("Vanguard composition requires hand and life modifiers.");
  const [width, height] = cardTextureSize(tier);
  const palette = Object.freeze({ ...options.palette });
  if (!scanBacked(face)) {
    await (options.loadFonts ?? ensureCardGlintFonts)();
    if (face.layout === "vanguard" && semanticFrame(face).flavor)
      await (options.loadFont ?? ensureCardGlintFont)(VANGUARD_FONT_ASSET);
  }
  signal.throwIfAborted();
  const loaded = await (options.loadImages ?? loadCanvasImages)(
    semanticCardAssetUrls(face),
    signal,
  );
  let canvas: CanvasRaster | undefined;
  try {
    canvas = rasterCanvas([width, height]);
    signal.throwIfAborted();
    if (!loaded.images.has(parts(face)[0]!.illustration ?? ""))
      throw new Error("Selected artwork is unavailable.");
    const c = canvas.getContext("2d");
    if (!c) throw Error("Card composition needs Canvas2D.");
    c.scale(canvas.width / FACE_WIDTH, canvas.height / FACE_HEIGHT);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = "high";
    if (scanBacked(face)) {
      const scan = loaded.images.get(face.illustration ?? "");
      if (!scan) throw Error("The complete selected scan is unavailable.");
      if (options.paintLayer !== "printing") c.drawImage(scan, ...regions(face)[0]!.rect);
      if (face.scanBorder) {
        c.globalCompositeOperation = "destination-over";
        c.fillStyle = cardStock(face.setCode, face.borderColor).border;
        c.fillRect(0, 0, FACE_WIDTH, FACE_HEIGHT);
        c.globalCompositeOperation = "source-over";
        if (options.paintLayer === "printing") c.clearRect(...regions(face)[0]!.rect);
      }
    } else if (face.layout === "prototype") {
      paintPrototype(
        c,
        face,
        loaded.images,
        options.rulesText !== false,
        palette,
        options.paintLayer,
      );
    } else {
      const frame = semanticFrame(face);
      const sideways = face.layout === "planar";
      if (sideways) {
        c.translate(0, FACE_HEIGHT);
        c.rotate(-Math.PI / 2);
      }
      c.scale(
        (sideways ? FACE_HEIGHT : FACE_WIDTH) / frame.size[0],
        (sideways ? FACE_WIDTH : FACE_HEIGHT) / frame.size[1],
      );
      paintSemanticFrame(
        c,
        face,
        frame,
        loaded.images,
        cardStock(face.setCode, face.borderColor).border,
        options.paintLayer,
      );
      if (options.paintLayer !== "artwork")
        paintSpecialText(c, face, loaded.images, options.rulesText !== false, palette);
    }
    c.setTransform(canvas.width / FACE_WIDTH, 0, 0, canvas.height / FACE_HEIGHT, 0, 0);
    c.globalCompositeOperation = "destination-in";
    c.fillStyle = "black";
    c.beginPath();
    c.roundRect(0, 0, FACE_WIDTH, FACE_HEIGHT, FACE_CORNER_RADIUS * FACE_WIDTH);
    c.fill();
    signal.throwIfAborted();
    return finishSemanticCanvas(canvas);
  } catch (error) {
    if (canvas) closeRaster(canvas);
    throw error;
  } finally {
    loaded.dispose();
  }
}

export function cardOpticalDocument(
  id: number,
  revision: number,
  value: SemanticCardInput,
  tier: TextureTier,
  rulesText: boolean,
  palette: CardSemanticPalette,
): CardDocument {
  const face = structuredClone({ ...value, setCode: value.setCode ?? "GLINT" });
  const capturedPalette = Object.freeze({ ...palette });
  const nativeDocument = isSemanticLayout(face)
    ? undefined
    : opticalDocument(
        id,
        revision,
        face,
        "prismatic",
        tier === "table" ? "table" : "inspect",
        rulesText,
      );
  if (nativeDocument) delete nativeDocument.recipe.overlayFoil;
  const size = cardTextureSize(tier);
  const layout = nativeDocument ? undefined : semanticLayoutRegions(face);
  const artWindows = nativeDocument
    ? nativeDocument.recipe.artWindows
    : layout!.filter((region) => region.role === "artwork").map((region) => region.rect);
  const raster = (paintLayer: "artwork" | "printing"): Raster => ({
    key: JSON.stringify([
      "manabrew-optical-v3",
      face,
      tier,
      paintLayer,
      rulesText,
      capturedPalette,
    ]),
    size,
    paint: async (host: RasterHost, signal: AbortSignal) => {
      const loadImages: typeof loadCanvasImages = async (urls, imageSignal) => {
        const lease = await host.images(
          [...new Set(urls.filter((url): url is string => Boolean(url)))].map((url) => ({
            url,
            width: canvasAssetWidth(url),
          })),
          imageSignal,
        );
        return { images: new Map(lease.value), dispose: () => lease.release() };
      };
      return nativeDocument
        ? composeCardTexture(
            { face, printingId: null, printedImage: null, paintLayer, rulesText },
            tier,
            signal,
            { loadImages, loadFonts: ensureCardGlintFonts, loadRetroFont: ensureCardGlintFonts },
          )
        : composeSemanticCardTexture(face, tier, signal, {
            palette: capturedPalette,
            paintLayer,
            rulesText,
            loadImages,
          });
    },
  });
  return {
    id,
    revision,
    recipe: {
      ...nativeDocument?.recipe,
      pack: nativeDocument?.recipe.pack ?? "manabrew-semantic",
      color: raster("artwork"),
      edges: nativeDocument?.recipe.edges ?? [],
      artWindows,
      cornerRadius: nativeDocument?.recipe.cornerRadius ?? FACE_CORNER_RADIUS,
      regions: nativeDocument
        ? nativeDocument.recipe.regions
        : layout!.map((region) => ({ id: region.name, rect: region.rect })),
      finishCoverageBase: 0,
    },
    layers: [
      {
        id: "magic-printing",
        order: 0,
        stage: "over-finish",
        raster: raster("printing"),
        finishCoverage: {
          add: {
            key: JSON.stringify(["manabrew-art-scope-v2", size, artWindows]),
            size,
            async paint(_host, signal) {
              signal.throwIfAborted();
              const canvas = rasterCanvas(size);
              try {
                const context = canvas.getContext("2d");
                if (!context) throw new Error("Card finish requires a 2D canvas context");
                context.fillStyle = "white";
                for (const [x, y, width, height] of artWindows)
                  context.fillRect(
                    x * canvas.width,
                    y * canvas.height,
                    width * canvas.width,
                    height * canvas.height,
                  );
                signal.throwIfAborted();
                return finishSemanticCanvas(canvas);
              } catch (error) {
                closeRaster(canvas);
                throw error;
              }
            },
          },
        },
      },
    ],
  };
}
