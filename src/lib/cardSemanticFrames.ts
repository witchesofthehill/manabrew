import type { CanvasContext, CanvasRaster } from "card-glint/canvas";
import {
  MSE_TEMPLATE_ROOT,
  FACE_WIDTH,
  FACE_HEIGHT,
  paintIllustration,
  type CanvasImages,
  type FaceRect,
  type RenderedCardInput,
} from "card-glint/magic/presentation";
import { createCardScratchCanvas, closeCardScratchCanvas } from "@/lib/cardRasterScratch";

export const VANGUARD_FONT_ASSET = {
  url: `${MSE_TEMPLATE_ROOT}/magic-vanguard.mse-style/fonts/Fritz%20Quadrata%20Cyrillic.ttf`,
  family: "Manabrew Vanguard",
  weight: "400",
  style: "normal",
};

export function createSemanticCanvas(width: number, height: number): CanvasRaster {
  return createCardScratchCanvas(width, height, true);
}

export interface SemanticFrame {
  root: string;
  size: readonly [number, number];
  art: FaceRect;
  title: FaceRect;
  type: FaceRect;
  rules: FaceRect;
  flavor?: FaceRect;
  hand?: FaceRect;
  life?: FaceRect;
  titleSize: number;
  typeSize: number;
  rulesSize: number;
  frame: string;
  vanguard?: "paper" | "mtgo_old" | "mtgo_new";
  components?: readonly { file: string; rect: FaceRect; alpha?: number }[];
}

export function semanticFrame(face: RenderedCardInput & { sourceFrame?: string }): SemanticFrame {
  const set = face.setCode?.toLowerCase();
  if (face.layout === "planar") {
    const who = set === "who";
    const original = !who && set !== "mom" && set !== "moc";
    return {
      root: `${MSE_TEMPLATE_ROOT}/magic-planechase.mse-style/${who ? "who" : "mom"}`,
      size: [1488, 1039],
      art: [41, 41, 1406, 959],
      title: [120, 64, 1248, who ? 51 : 54],
      type: [340, 696, 808, who ? 38 : 41],
      rules: who ? [170, 759, 1148, 218] : [175, 754, 1138, original ? 202 : 227],
      titleSize: 36,
      typeSize: 29,
      rulesSize: 28,
      frame: original ? "card_og.png" : "card.png",
      components: [
        { file: "namebox.png", rect: who ? [101, 50, 1286, 79] : [99, 46, 1290, 92], alpha: 0.8 },
        { file: "typebox.png", rect: who ? [306, 686, 876, 54] : [308, 688, 872, 54], alpha: 0.8 },
        { file: "textbox.png", rect: [118, 669, 1252, 326], alpha: 0.7 },
        { file: original ? "copyright_round.png" : "copyright.png", rect: [0, 0, 1488, 1039] },
      ],
    };
  }
  if (face.layout === "scheme") {
    const bolas = set === "e01" || set === "oe01";
    return {
      root: `${MSE_TEMPLATE_ROOT}/magic-archenemy.mse-style/${bolas ? "bolas" : "original"}`,
      size: [744, 1039],
      art: bolas ? [33, 33, 676, 911] : [42, 40, 658, 958],
      title: bolas ? [137, 72, 472, 42] : [119, 72, 508, 31],
      type: bolas ? [185, 149, 381, 32] : [173, 157, 407, 29],
      rules: bolas ? [113, 730, 518, 196] : [109, 731, 526, 206],
      titleSize: bolas ? 27 : 22,
      typeSize: bolas ? 23 : 21,
      rulesSize: bolas ? 23 : 21,
      frame: "card.png",
    };
  }
  const online = ["pmoa", "pmo", "pmic", "vma"].includes(set ?? "");
  const modern = online && face.sourceFrame === "2015";
  const vanguard = online ? (modern ? "mtgo_new" : "mtgo_old") : "paper";
  return {
    root: `${MSE_TEMPLATE_ROOT}/magic-vanguard.mse-style/${vanguard}`,
    size: [744, 1039],
    art: modern ? [79, 119, 586, 479] : online ? [94, 118, 551, 447] : [91, 104, 562, 494],
    title: modern ? [106, 55, 534, 44] : online ? [114, 69, 516, 38] : [137, 53, 470, 43],
    type: modern ? [83, 609, 578, 37] : online ? [117, 584, 510, 33] : [125, 613, 494, 26],
    rules: modern ? [86, 670, 571, 246] : online ? [104, 632, 536, 248] : [88, 655, 568, 115],
    flavor: online ? undefined : [153, 782, 437, 140],
    hand: modern ? [160, 936, 76, 44] : online ? [186, 900, 40, 41] : [83, 872, 44, 47],
    life: modern ? [508, 936, 76, 44] : online ? [520, 900, 40, 41] : [615, 872, 44, 47],
    titleSize: online ? 30 : 37,
    typeSize: modern ? 25 : 22,
    rulesSize: 28,
    frame: "card.png",
    vanguard,
  };
}

export function semanticFrameAssets(frame: SemanticFrame): string[] {
  return [
    frame.frame,
    "card_mask.png",
    "image_mask.png",
    ...(frame.components ?? []).map((part) => part.file),
  ].map((file) => `${frame.root}/${file}`);
}

export function frameRect(frame: SemanticFrame, rect: FaceRect, sideways = false): FaceRect {
  const width = sideways ? FACE_HEIGHT : FACE_WIDTH;
  const height = sideways ? FACE_WIDTH : FACE_HEIGHT;
  return [
    (rect[0] / frame.size[0]) * width,
    (rect[1] / frame.size[1]) * height,
    (rect[2] / frame.size[0]) * width,
    (rect[3] / frame.size[1]) * height,
  ];
}

function image(images: CanvasImages, url: string) {
  const value = images.get(url);
  if (!value) throw new Error(`Special frame resource is unavailable: ${url}`);
  return value;
}

function luminanceMask(images: CanvasImages, url: string, width: number, height: number) {
  const canvas = createSemanticCanvas(width, height);
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Special frames require Canvas2D.");
    context.drawImage(image(images, url), 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    for (let i = 0; i < pixels.data.length; i += 4)
      pixels.data[i + 3] = (pixels.data[i]! * pixels.data[i + 3]!) / 255;
    context.putImageData(pixels, 0, 0);
    return canvas;
  } catch (error) {
    closeCardScratchCanvas(canvas);
    throw error;
  }
}

export function paintSemanticFrame(
  c: CanvasContext,
  face: RenderedCardInput,
  frame: SemanticFrame,
  images: CanvasImages,
  stock: string,
  layer?: "artwork" | "printing",
): void {
  const [width, height] = frame.size;
  const transform = c.getTransform();
  const pixelWidth = Math.max(1, Math.ceil(width * Math.hypot(transform.a, transform.b)));
  const pixelHeight = Math.max(1, Math.ceil(height * Math.hypot(transform.c, transform.d)));
  const canvas = createSemanticCanvas(pixelWidth, pixelHeight);
  const masks: CanvasRaster[] = [];
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Special frames require Canvas2D.");
    context.scale(pixelWidth / width, pixelHeight / height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    const artMask = luminanceMask(images, `${frame.root}/image_mask.png`, pixelWidth, pixelHeight);
    masks.push(artMask);
    if (layer !== "printing") {
      paintIllustration(context, face, images, frame.art, "artwork");
      context.globalCompositeOperation = "destination-in";
      context.drawImage(artMask, 0, 0, width, height);
      c.drawImage(canvas, 0, 0, width, height);
      context.clearRect(0, 0, width, height);
    }
    if (layer === "artwork") return;
    context.globalCompositeOperation = "source-over";
    context.fillStyle = stock;
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = "destination-out";
    context.drawImage(artMask, 0, 0, width, height);
    context.globalCompositeOperation = "source-over";
    for (const part of frame.components ?? []) {
      context.globalAlpha = part.alpha ?? 1;
      context.drawImage(image(images, `${frame.root}/${part.file}`), ...part.rect);
    }
    context.globalAlpha = 1;
    c.drawImage(canvas, 0, 0, width, height);
    context.clearRect(0, 0, width, height);
    context.drawImage(image(images, `${frame.root}/${frame.frame}`), 0, 0, width, height);
    const frameMask = luminanceMask(images, `${frame.root}/card_mask.png`, pixelWidth, pixelHeight);
    masks.push(frameMask);
    context.globalCompositeOperation = "destination-in";
    context.drawImage(frameMask, 0, 0, width, height);
    c.drawImage(canvas, 0, 0, width, height);
  } finally {
    closeCardScratchCanvas(canvas);
    for (const mask of masks) closeCardScratchCanvas(mask);
  }
}

export function prototypeFrameAssets(face: RenderedCardInput): string[] {
  const color = face.colors?.[0]?.toLowerCase() ?? "c";
  const code = face.colors && face.colors.length > 1 ? "m" : color;
  return ["box", "cost", "pt"].map(
    (part) =>
      `${MSE_TEMPLATE_ROOT}/magic-modules.mse-include/protoboxes/${part}/${code}${part}.png`,
  );
}

export function paintPrototypeFrame(
  c: CanvasContext,
  face: RenderedCardInput,
  images: CanvasImages,
): void {
  const [box, cost, pt] = prototypeFrameAssets(face).map((url) => image(images, url));
  c.save();
  c.scale(FACE_WIDTH / 375, FACE_HEIGHT / 523);
  c.drawImage(box!, 0, 0, 324, 4, 25, 326, 324, 4);
  c.drawImage(box!, 0, 4, 324, 152, 25, 330, 324, 53);
  c.drawImage(box!, 0, 156, 324, 6, 25, 383, 324, 6);
  const manaWidth = Math.max(30, (face.manaSymbols?.length ?? 0) * 14);
  const costWidth = 9 + manaWidth;
  const left = 346 - costWidth;
  c.drawImage(cost!, 0, 0, 16, 48, left, 329, 8, 24);
  c.drawImage(cost!, 16, 0, 106, 48, left + 8, 329, costWidth - 12, 24);
  c.drawImage(cost!, 122, 0, 8, 48, 342, 329, 4, 24);
  c.drawImage(pt!, 291, 355, 64, 32);
  c.restore();
}
