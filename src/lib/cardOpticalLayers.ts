import { opticalDocument } from "card-glint/magic";
import type { RasterHost } from "card-glint";
import {
  faceCornerRadius,
  FACE_CORNER_RADIUS,
  isSemanticLayout,
  type RenderedCardInput,
} from "card-glint/magic/presentation";
import { CanvasSource, Texture } from "pixi.js";
import { cardImageLoader } from "@/lib/cardRenderArtwork";
import { ensureCardGlintFonts } from "@/lib/cardGlintAssets";
import type { CardFoilRegion } from "@/lib/cardFinish";

export interface CardOpticalLayers {
  artwork: Texture;
  printing: Texture;
  coverage: Texture;
  artWindows: readonly CardFoilRegion[];
  cornerRadius: number;
}

export interface CardOpticalLease extends CardOpticalLayers {
  release(): void;
}

interface OpticalSource {
  face: RenderedCardInput;
  artUrls: readonly (string | undefined)[];
  rulesText: boolean;
  width: number;
  height: number;
  cornerRadius: number;
  entry?: OpticalEntry;
}

interface OpticalEntry {
  refs: number;
  controller: AbortController;
  ready: Promise<CardOpticalLayers>;
  layers?: CardOpticalLayers;
}

const sources = new WeakMap<object, OpticalSource>();

export function registerCardOpticalSource(
  canvas: HTMLCanvasElement,
  face: RenderedCardInput,
  artUrls: readonly (string | undefined)[],
  rulesText: boolean,
): void {
  sources.set(canvas, {
    face,
    artUrls,
    rulesText,
    width: canvas.width,
    height: canvas.height,
    cornerRadius: isSemanticLayout(face) ? FACE_CORNER_RADIUS : faceCornerRadius(face),
  });
}

export function copyCardOpticalSource(from: HTMLCanvasElement, to: HTMLCanvasElement): void {
  const source = sources.get(from);
  if (source) sources.set(to, source);
  else sources.delete(to);
}

export function getCardSourceCornerRadius(texture: Texture): number {
  return sources.get(texture.source.resource as object)?.cornerRadius ?? 0.035;
}

function disposeLayers(layers: CardOpticalLayers): void {
  for (const texture of [layers.artwork, layers.printing, layers.coverage]) {
    const canvas = texture.source.resource as HTMLCanvasElement;
    texture.destroy(true);
    canvas.width = canvas.height = 0;
  }
}

async function composeLayers(
  source: OpticalSource,
  signal: AbortSignal,
): Promise<CardOpticalLayers> {
  await ensureCardGlintFonts();
  signal.throwIfAborted();
  const document = opticalDocument(0, 0, source.face, "prismatic", "inspect", source.rulesText);
  const printing = document.layers?.[0];
  const coverage = printing?.finishCoverage?.add;
  if (!printing || !coverage) throw new Error("Card Glint optical printing layers are unavailable");
  const loadImages = cardImageLoader(source.artUrls);
  const host: RasterHost = {
    async images(requests, paintSignal) {
      const lease = await loadImages(
        requests.map(({ url }) => url),
        paintSignal,
      );
      return { value: lease.images, release: lease.dispose };
    },
  };
  const textures: Texture[] = [];
  try {
    for (const raster of [document.recipe.color, printing.raster, coverage]) {
      const painted = await raster.paint(host, signal);
      try {
        signal.throwIfAborted();
        const canvas = window.document.createElement("canvas");
        canvas.width = source.width;
        canvas.height = source.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Optical printing requires a 2D canvas context");
        context.drawImage(painted, 0, 0, canvas.width, canvas.height);
        textures.push(
          new Texture({
            source: new CanvasSource({
              resource: canvas,
              width: canvas.width,
              height: canvas.height,
              resolution: 1,
              autoGenerateMipmaps: false,
            }),
          }),
        );
      } finally {
        painted.width = painted.height = 0;
      }
    }
    return {
      artwork: textures[0]!,
      printing: textures[1]!,
      coverage: textures[2]!,
      artWindows: document.recipe.artWindows.map(([x, y, width, height]) => ({
        x,
        y,
        width,
        height,
      })),
      cornerRadius: document.recipe.cornerRadius,
    };
  } catch (error) {
    for (const texture of textures) {
      const canvas = texture.source.resource as HTMLCanvasElement;
      texture.destroy(true);
      canvas.width = canvas.height = 0;
    }
    throw error;
  }
}

export function acquireCardOpticalLayers(
  texture: Texture,
  signal: AbortSignal,
): Promise<CardOpticalLease> | null {
  const source = sources.get(texture.source.resource as object);
  if (!source) return null;
  signal.throwIfAborted();
  let entry = source.entry;
  if (!entry) {
    const controller = new AbortController();
    const created: OpticalEntry = {
      refs: 0,
      controller,
      ready: composeLayers(source, controller.signal).then((layers) => {
        if (controller.signal.aborted) {
          disposeLayers(layers);
          throw controller.signal.reason;
        }
        created.layers = layers;
        return layers;
      }),
    };
    source.entry = entry = created;
  }
  const retained = entry;
  retained.refs++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (--retained.refs === 0) {
      retained.controller.abort();
      if (retained.layers) disposeLayers(retained.layers);
      if (source.entry === retained) source.entry = undefined;
    }
  };
  return new Promise<CardOpticalLease>((resolve, reject) => {
    const abort = () => {
      release();
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    void retained.ready.then(
      (layers) => {
        signal.removeEventListener("abort", abort);
        if (released) return;
        resolve({ ...layers, release });
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        release();
        reject(error);
      },
    );
  });
}
