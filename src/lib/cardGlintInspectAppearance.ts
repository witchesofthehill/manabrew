import { canvas } from "card-glint/canvas";
import type { CardDocument, CardLayer, FaceRecipe, Instance, Raster, Rect } from "card-glint";
import type { CardCosmetics } from "@/protocol/deck";

export interface CardInspectAppearance {
  rainFog?: Instance["rainFog"];
  wear?: Instance["wear"];
  cardstock?: Instance["cardstock"];
  printDots?: CardCosmetics["printDots"];
  deformation?: Instance["deformation"];
  coverage?: {
    area: "full" | "artwork" | "left" | "right";
    amount: number;
  };
  overlayFoil?: FaceRecipe["overlayFoil"] | null;
  hologram?: {
    shape: "ellipse" | "rectangle";
    rect: Rect;
    strength: number;
    seed: number;
  } | null;
}

export function cardInspectDocumentAppearanceKey(appearance?: CardInspectAppearance): string {
  return JSON.stringify([appearance?.coverage, appearance?.overlayFoil, appearance?.hologram]);
}

function coverageMask(
  recipe: FaceRecipe,
  coverage: NonNullable<CardInspectAppearance["coverage"]>,
): Raster {
  const rects: readonly Rect[] =
    coverage.area === "artwork"
      ? recipe.artWindows
      : [[coverage.area === "right" ? 0.5 : 0, 0, 0.5, 1]];
  const size = recipe.color.size;
  return {
    key: JSON.stringify(["manabrew-inspect-coverage-v1", size, rects, coverage.amount]),
    size,
    async paint(_host, signal) {
      signal.throwIfAborted();
      const mask = canvas(size);
      const context = mask.getContext("2d");
      if (!context) throw new Error("Card finish requires a 2D canvas context");
      context.fillStyle = "white";
      context.globalAlpha = coverage.amount;
      const path = new Path2D();
      for (const [x, y, width, height] of rects)
        path.rect(x * size[0], y * size[1], width * size[0], height * size[1]);
      context.fill(path);
      return mask;
    },
  };
}

function hologramMask(shape: "ellipse" | "rectangle"): Raster {
  const size = [128, 128] as const;
  return {
    key: JSON.stringify(["manabrew-inspect-hologram-v1", size, shape]),
    size,
    async paint(_host, signal) {
      signal.throwIfAborted();
      const mask = canvas(size);
      const context = mask.getContext("2d");
      if (!context) throw new Error("Card hologram requires a 2D canvas context");
      context.fillStyle = "white";
      if (shape === "ellipse") {
        context.beginPath();
        context.ellipse(64, 64, 64, 64, 0, 0, Math.PI * 2);
        context.fill();
      } else context.fillRect(0, 0, ...size);
      return mask;
    },
  };
}

export function cardFinishCoverageDocument(
  base: CardDocument,
  coverage?: CardInspectAppearance["coverage"],
): CardDocument {
  if (!coverage) return base;
  const recipe = {
    ...base.recipe,
    finishCoverageBase: coverage.area === "full" ? coverage.amount : 0,
  };
  const layers =
    base.layers?.map((layer) =>
      layer.id === "magic-printing"
        ? {
            ...layer,
            finishCoverage: layer.finishCoverage
              ? { ...layer.finishCoverage, add: undefined }
              : undefined,
          }
        : layer,
    ) ?? [];
  if (coverage.area !== "full") {
    const raster: Raster = {
      key: "manabrew-inspect-empty-v1",
      size: [1, 1],
      async paint(_host, signal) {
        signal.throwIfAborted();
        return canvas([1, 1]);
      },
    };
    const layer: CardLayer = {
      id: "manabrew-inspect-coverage",
      order: 0,
      stage: "under-finish",
      raster,
      finishCoverage: { add: coverageMask(recipe, coverage) },
    };
    layers.push(layer);
  }
  return { ...base, recipe, layers };
}

export function cardInspectAppearanceDocument(
  base: CardDocument,
  revision: number,
  appearance?: CardInspectAppearance,
): CardDocument {
  const covered = cardFinishCoverageDocument(base, appearance?.coverage);
  const recipe = { ...covered.recipe };
  if (appearance?.overlayFoil !== undefined)
    recipe.overlayFoil = appearance.overlayFoil ?? undefined;
  if (appearance?.hologram !== undefined) {
    const hologram = appearance.hologram;
    recipe.hologram = hologram
      ? {
          mask: hologramMask(hologram.shape),
          rect: hologram.rect,
          strength: hologram.strength,
          seed: hologram.seed,
        }
      : undefined;
  }
  return { ...covered, revision, recipe };
}
