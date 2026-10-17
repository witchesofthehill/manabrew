import type { CardDocument, Raster, RasterHost, Tier } from "card-glint";
import { opticalDocument } from "card-glint/magic";
import {
  cardStock,
  faceStats,
  FACE_WIDTH,
  FACE_HEIGHT,
  FACE_CORNER_RADIUS,
  canvasAssetWidth,
  loadCanvasFonts,
  loadCanvasImages,
  faceManaAssets,
  paintFittedText,
  paintMana,
  paintIllustration,
  layoutRules,
  paintRulesLayout,
  type FaceRect,
  type RenderedCardInput,
  type CanvasImages,
} from "card-glint/magic/presentation";
import { getTheme } from "@/hooks/useTheme";
import type { GameThemeColors } from "@/themes/gameTheme";

export interface SemanticCardInput extends RenderedCardInput {
  handModifier?: string;
  lifeModifier?: string;
  scanBorder?: boolean;
  faces?: SemanticCardInput[];
}
type Role = "rules" | "stats" | "artwork" | "title" | "type";
interface Region {
  role: Role;
  rect: FaceRect;
  faceIndex: number;
}
const LAYOUTS: Record<string, true> = {
  room: true,
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
  if (face.layout !== "room") return [face];
  if (face.faces?.length !== 2) throw Error("Room composition requires both doors.");
  return face.faces;
}
function roomRules(face: SemanticCardInput): FaceRect {
  return [32, 280, 616, parts(face).some((part) => faceStats(part)) ? 128 : 160];
}
export function semanticCardAssetUrls(face: SemanticCardInput): (string | null | undefined)[] {
  return parts(face).flatMap((part) => [part.illustration, ...faceManaAssets(part)]);
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
  if (face.layout === "room") {
    for (let i = 0; i < 2; i++) {
      const x = 24 + i * 330;
      add("title", [x, 24, 302, 30], i);
      add("artwork", [x, 62, 302, 174], i);
      add("type", [x, 244, 302, 24], i);
      add("rules", [x + 8, 280, 286, roomRules(face)[3]], i);
      if (faceStats(parts(face)[i]!)) add("stats", [x + 194, 420, 108, 24], i);
    }
  } else if (face.layout === "planar") {
    add("title", [26, 22, 628, 34]);
    add("artwork", [26, 65, 628, 194]);
    add("type", [26, 266, 628, 28]);
    add("rules", [36, 305, 608, faceStats(face) ? 101 : 137]);
    if (faceStats(face)) add("stats", [524, 418, 130, 26]);
  } else {
    const vanguard = face.layout === "vanguard";
    add("title", [28, 28, 432, 34]);
    add("artwork", [28, 72, 432, vanguard ? 250 : 260]);
    add("type", [28, vanguard ? 332 : 342, 432, 30]);
    add("rules", [38, vanguard ? 374 : 384, 412, vanguard ? 204 : faceStats(face) ? 202 : 238]);
    if (vanguard) add("stats", [28, 590, 432, 40]);
    else if (faceStats(face)) add("stats", [330, 600, 130, 28]);
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
  const sideways = face.layout === "room" || face.layout === "planar";
  const drawn = regions(face);
  return drawn.map(({ role, rect: [x, y, w, h], faceIndex }) => ({
    name: `${role}_${faceIndex}`,
    role,
    faceIndex,
    rect: (sideways
      ? [y / FACE_WIDTH, 1 - (x + w) / FACE_HEIGHT, h / FACE_WIDTH, w / FACE_HEIGHT]
      : [x / FACE_WIDTH, y / FACE_HEIGHT, w / FACE_WIDTH, h / FACE_HEIGHT]) as FaceRect,
    angle: sideways ? 270 : 0,
  }));
}
function paintRegion(
  c: CanvasRenderingContext2D,
  face: SemanticCardInput,
  region: Region,
  images: CanvasImages,
  rulesText: boolean,
  printing: GameThemeColors["cardPrinting"],
  paintLayer?: "artwork" | "printing",
) {
  const [x, y, w, h] = region.rect;
  if (region.role === "artwork") {
    if (!images.has(face.illustration ?? "")) throw Error("Selected artwork is unavailable.");
    paintIllustration(c, face, images, region.rect, paintLayer);
    return;
  }
  if (paintLayer === "artwork") return;
  c.fillStyle = printing.paper;
  c.fillRect(x - 4, y - 4, w + 8, h + 8);
  c.fillStyle = printing.ink;
  c.textBaseline = "middle";
  c.textAlign = "left";
  if (region.role === "title") {
    const symbols = face.manaSymbols ?? [];
    const size = Math.min(24, h - 4);
    const manaWidth = symbols.length * (size + 2);
    paintFittedText(c, face.name, x + 4, y + h / 2, w - manaWidth - 12, h * 0.75, true);
    symbols.forEach((symbol, i) =>
      paintMana(c, symbol, x + w - manaWidth + i * (size + 2), y + (h - size) / 2, size, images),
    );
  } else if (region.role === "type") {
    paintFittedText(
      c,
      face.typeLine ?? "",
      x + 4,
      y + h / 2,
      w - 8,
      h * 0.72,
      false,
      1,
      "CardRenderer MTG Beleren",
      0,
      face.textInk,
    );
  } else if (region.role === "stats") {
    const text =
      face.layout === "vanguard"
        ? `Hand ${face.handModifier}     Life ${face.lifeModifier}`
        : (faceStats(face)?.text ?? "");
    paintFittedText(
      c,
      text,
      x + 8,
      y + h / 2,
      w - 16,
      23,
      true,
      1,
      "CardRenderer MTG Beleren",
      0,
      face.textInk,
      "stats",
    );
  } else if (rulesText) {
    const paragraphs =
      face.rulesParagraphs ??
      (face.rulesText ?? "")
        .split("\n")
        .filter(Boolean)
        .map((text) => ({ role: "rules" as const, runs: [{ text }] }));
    const layout = layoutRules(c, paragraphs, { x, y, width: w, height: h }, 22, 8);
    paintRulesLayout(c, layout, images);
  }
}
export interface SemanticImageLease {
  images: CanvasImages;
  dispose(): void;
}

export interface SemanticCompositionOptions {
  rulesText?: boolean;
  paintLayer?: "artwork" | "printing";
  loadImages?: (
    urls: readonly (string | null | undefined)[],
    signal: AbortSignal,
  ) => Promise<SemanticImageLease>;
  loadFonts?: () => Promise<void>;
}
export async function composeSemanticCardTexture(
  face: SemanticCardInput,
  tier: "table" | "inspect",
  signal: AbortSignal,
  options: SemanticCompositionOptions = {},
): Promise<HTMLCanvasElement> {
  if (!isSemanticLayout(face)) throw Error("Not a semantic card layout.");
  const faces = parts(face);
  if (face.layout === "vanguard" && (face.handModifier == null || face.lifeModifier == null))
    throw Error("Vanguard composition requires hand and life modifiers.");
  if (!scanBacked(face)) await (options.loadFonts ?? loadCanvasFonts)();
  signal.throwIfAborted();
  const loaded = await (options.loadImages ?? loadCanvasImages)(
    semanticCardAssetUrls(face),
    signal,
  );
  const canvas = document.createElement("canvas");
  canvas.width = tier === "table" ? 244 : 732;
  canvas.height = tier === "table" ? 340 : 1020;
  const printing = getTheme().gameTheme.cardPrinting;
  try {
    signal.throwIfAborted();
    const c = canvas.getContext("2d");
    if (!c) throw Error("Card composition needs Canvas2D.");
    c.scale(canvas.width / FACE_WIDTH, canvas.height / FACE_HEIGHT);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = "high";
    c.fillStyle = cardStock(face.setCode, face.borderColor).border;
    c.fillRect(0, 0, FACE_WIDTH, FACE_HEIGHT);
    if (scanBacked(face)) {
      const scan = loaded.images.get(face.illustration ?? "");
      if (!scan) throw Error("The complete selected scan is unavailable.");
      if (options.paintLayer === "printing") c.clearRect(...regions(face)[0]!.rect);
      else c.drawImage(scan, ...regions(face)[0]!.rect);
    } else {
      const sideways = face.layout === "room" || face.layout === "planar";
      if (sideways) {
        c.translate(0, FACE_HEIGHT);
        c.rotate(-Math.PI / 2);
      }
      const width = sideways ? FACE_HEIGHT : FACE_WIDTH;
      const height = sideways ? FACE_WIDTH : FACE_HEIGHT;
      c.fillStyle = printing.frame;
      c.fillRect(16, 16, width - 32, height - 32);
      if (face.layout === "room") {
        c.fillStyle = printing.paper;
        const [x, y, w, h] = roomRules(face);
        c.fillRect(x - 4, y - 4, w + 8, h + 8);
      }
      for (const region of regions(face))
        paintRegion(
          c,
          faces[region.faceIndex]!,
          region,
          loaded.images,
          options.rulesText !== false,
          printing,
          options.paintLayer,
        );
      c.fillStyle = printing.footer;
      c.textBaseline = "middle";
      const artists = [...new Set(faces.map((part) => part.artist).filter(Boolean))].join(" / ");
      const footer = [face.collectorNumber, face.rarity, face.setCode?.toUpperCase(), artists]
        .filter(Boolean)
        .join(" · ");
      if (options.paintLayer !== "artwork")
        paintFittedText(
          c,
          footer,
          28,
          height - 24,
          width - 56,
          12,
          false,
          1,
          "CardRenderer MTG MPlantin",
        );
    }
    c.setTransform(canvas.width / FACE_WIDTH, 0, 0, canvas.height / FACE_HEIGHT, 0, 0);
    c.globalCompositeOperation = "destination-in";
    c.fillStyle = "black";
    c.beginPath();
    c.roundRect(0, 0, FACE_WIDTH, FACE_HEIGHT, FACE_CORNER_RADIUS * FACE_WIDTH);
    c.fill();
    return canvas;
  } catch (error) {
    canvas.width = canvas.height = 0;
    throw error;
  } finally {
    loaded.dispose();
  }
}

export function cardOpticalDocument(
  id: number,
  revision: number,
  value: SemanticCardInput,
  tier: Tier = "inspect",
  rulesText = true,
): CardDocument {
  if (!isSemanticLayout(value)) {
    const document = opticalDocument(id, revision, value, "prismatic", tier, rulesText);
    delete document.recipe.overlayFoil;
    return document;
  }
  const face = structuredClone({ ...value, setCode: value.setCode ?? "GLINT" });
  const size = (tier === "table" ? [244, 340] : [732, 1020]) as readonly [number, number];
  const layout = semanticLayoutRegions(face);
  const artWindows = layout
    .filter((region) => region.role === "artwork")
    .map((region) => region.rect);
  const raster = (paintLayer: "artwork" | "printing"): Raster => ({
    key: JSON.stringify(["manabrew-semantic-optical-v1", face, tier, paintLayer, rulesText]),
    size,
    paint: (host: RasterHost, signal: AbortSignal) =>
      composeSemanticCardTexture(face, tier, signal, {
        paintLayer,
        rulesText,
        async loadImages(urls, imageSignal) {
          const lease = await host.images(
            [...new Set(urls.filter((url): url is string => Boolean(url)))].map((url) => ({
              url,
              width: canvasAssetWidth(url),
            })),
            imageSignal,
          );
          return { images: lease.value, dispose: () => lease.release() };
        },
      }),
  });
  return {
    id,
    revision,
    recipe: {
      pack: "manabrew-semantic",
      color: raster("artwork"),
      edges: [],
      artWindows,
      cornerRadius: FACE_CORNER_RADIUS,
      regions: layout.map((region) => ({ id: region.name, rect: region.rect })),
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
            key: JSON.stringify(["manabrew-semantic-art-scope-v1", size, artWindows]),
            size,
            async paint(_host, signal) {
              signal.throwIfAborted();
              const canvas = document.createElement("canvas");
              [canvas.width, canvas.height] = size;
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
              return canvas;
            },
          },
        },
      },
    ],
  };
}
