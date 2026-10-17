import { magic } from "card-glint/magic";
import type { CardDocument, RasterHost, Rect } from "card-glint";
import {
  faceCornerRadius,
  FACE_CORNER_RADIUS,
  type RenderedCardInput,
} from "card-glint/magic/presentation";
import { CanvasSource, Texture } from "pixi.js";
import { cardImageLoader } from "@/lib/cardRenderArtwork";
import { ensureCardGlintFonts } from "@/lib/cardGlintAssets";
import type { CardFoilRegion } from "@/lib/cardFinish";
import { getCardArtWindows } from "@/lib/cardRenderGeometry";
import { cardOpticalDocument, isSemanticLayout } from "@/lib/cardSemanticLayout";

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
  canvas: HTMLCanvasElement;
  id: number;
  face: RenderedCardInput;
  artUrls: readonly (string | undefined)[];
  rulesText: boolean;
  width: number;
  height: number;
  cornerRadius: number;
  entry?: OpticalEntry;
  finish?: CardFinishSource;
}

interface OpticalEntry {
  refs: number;
  controller: AbortController;
  ready: Promise<CardOpticalLayers>;
  layers?: CardOpticalLayers;
}

export interface CardFinishSource {
  kind: "native" | "raster";
  key: string;
  document: CardDocument;
  host: RasterHost;
}
const sources = new WeakMap<object, OpticalSource>();
let sourceId = 0;

export function registerCardOpticalSource(
  canvas: HTMLCanvasElement,
  face: RenderedCardInput,
  artUrls: readonly (string | undefined)[],
  rulesText: boolean,
): void {
  sources.set(canvas, {
    canvas,
    id: ++sourceId,
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
export function cardRasterHost(artUrls: readonly (string | undefined)[]): RasterHost {
  const loadImages = cardImageLoader(artUrls);
  return {
    async images(requests, signal) {
      const lease = await loadImages(
        requests.map(({ url }) => url),
        signal,
      );
      const resized: ImageBitmap[] = [];
      const images = new Map<string, ImageBitmap>();
      try {
        for (const request of requests) {
          signal.throwIfAborted();
          const image = lease.images.get(request.url);
          if (!image) continue;
          if (request.width && image.width !== request.width) {
            const bitmap = await createImageBitmap(image, {
              resizeWidth: request.width,
              resizeQuality: "high",
            });
            resized.push(bitmap);
            images.set(request.url, bitmap);
          } else images.set(request.url, image);
        }
        signal.throwIfAborted();
        let released = false;
        return {
          value: images,
          release() {
            if (released) return;
            released = true;
            for (const bitmap of resized) bitmap.close();
            images.clear();
            lease.dispose();
          },
        };
      } catch (error) {
        for (const bitmap of resized) bitmap.close();
        lease.dispose();
        throw error;
      }
    },
  };
}

export function getCardFinishSource(texture: Texture): CardFinishSource | null {
  const source = sources.get(texture.source.resource as object);
  if (!source) return null;
  if (!source.finish) {
    if (isSemanticLayout(source.face)) {
      const key = `manabrew-semantic-finish:${source.id}`;
      const size = [source.width, source.height] as const;
      const artWindows: Rect[] = getCardArtWindows(source.canvas).map(({ x, y, width, height }) => [
        x,
        y,
        width,
        height,
      ]);
      source.finish = {
        kind: "raster",
        key,
        document: {
          id: 0,
          revision: 0,
          recipe: {
            pack: "manabrew-semantic",
            color: {
              key,
              size,
              async paint(_host, signal) {
                signal.throwIfAborted();
                const canvas = document.createElement("canvas");
                [canvas.width, canvas.height] = size;
                const context = canvas.getContext("2d");
                if (!context) throw new Error("Card finish requires a 2D canvas context");
                context.drawImage(source.canvas, 0, 0, ...size);
                return canvas;
              },
            },
            edges: artWindows.map((rect) => ({
              key: JSON.stringify([key, rect]),
              asset: { url: key, width: 512 },
              crop: rect,
              destination: rect,
              clip: rect,
              threshold: 20,
            })),
            artWindows,
            cornerRadius: source.cornerRadius,
            regions: [],
          },
        },
        host: {
          async images(requests, signal) {
            const images = new Map<string, ImageBitmap>();
            try {
              for (const request of requests) {
                if (images.has(request.url)) continue;
                signal.throwIfAborted();
                images.set(
                  request.url,
                  await createImageBitmap(source.canvas, {
                    resizeWidth: request.width ?? source.width,
                    resizeQuality: "high",
                  }),
                );
              }
              signal.throwIfAborted();
              return {
                value: images,
                release() {
                  for (const image of images.values()) image.close();
                  images.clear();
                },
              };
            } catch (error) {
              for (const image of images.values()) image.close();
              throw error;
            }
          },
        },
      };
      return source.finish;
    }
    const recipe = magic.describe(source.face, "inspect");
    source.finish = {
      kind: "native",
      key: JSON.stringify([recipe.pack, recipe.color.size, recipe.edges, recipe.stamp?.key]),
      document: { id: 0, revision: 0, recipe },
      host: cardRasterHost(source.artUrls),
    };
  }
  return source.finish;
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
  const document = cardOpticalDocument(0, 0, source.face, "inspect", source.rulesText);
  const printing = document.layers?.[0];
  const coverage = printing?.finishCoverage?.add;
  if (!printing || !coverage) throw new Error("Card Glint optical printing layers are unavailable");
  const host = cardRasterHost(source.artUrls);
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
