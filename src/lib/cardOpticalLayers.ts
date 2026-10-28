import { magic } from "card-glint/magic";
import { closeRaster } from "card-glint/canvas";
import type { CardDocument, RasterHost, Rect } from "card-glint";
import {
  faceCornerRadius,
  FACE_CORNER_RADIUS,
  type RenderedCardInput,
} from "card-glint/magic/presentation";
import { Texture } from "pixi.js";
import type { TextureSource } from "pixi.js";
import { cardImageLoader } from "@/lib/cardRenderArtwork";
import type { CardFoilRegion } from "@/lib/cardFinish";
import { getCardArtWindows } from "@/lib/cardRenderGeometry";
import { cardOpticalDocument, isSemanticLayout } from "@/lib/cardSemanticLayout";
import type { CardSemanticPalette } from "@/lib/cardSemanticLayout";
import type { CardRaster, CardRenderTier } from "@/lib/cardRenderTypes";
import { ownCardRaster, retainCardRaster, releaseCardRaster } from "@/lib/cardRenderTypes";
import { composeCardOffThread } from "@/lib/cardCompositionWorker";
import { createGeneratedCardTexture } from "@/pixi/generatedCardTexture";

export interface CardOpticalLayers {
  artwork: Texture;
  printing: Texture;
  artWindows: readonly CardFoilRegion[];
  cornerRadius: number;
}

export interface CardOpticalLease extends CardOpticalLayers {
  release(): void;
}

interface OpticalSource {
  canvas: CardRaster;
  id: number;
  face: RenderedCardInput;
  artUrls: readonly (string | undefined)[];
  rulesText: boolean;
  width: number;
  height: number;
  cornerRadius: number;
  tier: CardRenderTier;
  palette: CardSemanticPalette;
  entry?: OpticalEntry;
  finish?: CardFinishSource;
  opticalFinish?: CardFinishSource;
}

interface OpticalEntry {
  refs: number;
  controller: AbortController;
  ready: Promise<CardOpticalLayers>;
  layers?: CardOpticalLayers;
  releaseSource(): void;
}

export interface CardFinishSource {
  kind: "native" | "raster";
  key: string;
  document: CardDocument;
  host: RasterHost;
}
const sources = new WeakMap<object, OpticalSource>();
const watchedSources = new WeakMap<TextureSource, { source: OpticalSource; detach(): void }>();
let sourceId = 0;

export function registerCardOpticalSource(
  canvas: CardRaster,
  face: RenderedCardInput,
  artUrls: readonly (string | undefined)[],
  rulesText: boolean,
  tier: CardRenderTier,
  palette: CardSemanticPalette,
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
    tier,
    palette,
  });
}

export function copyCardOpticalSource(from: CardRaster, to: CardRaster): void {
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

function watchOpticalSource(source: OpticalSource, texture: TextureSource): void {
  const watched = watchedSources.get(texture);
  if (watched?.source === source) return;
  watched?.detach();
  const invalidate = () => {
    source.id = ++sourceId;
    source.entry = undefined;
    source.finish = undefined;
    source.opticalFinish = undefined;
    source.width = source.canvas.width;
    source.height = source.canvas.height;
  };
  const detach = () => {
    texture.off("update", invalidate);
    texture.off("resize", invalidate);
    texture.off("destroy", detach);
    if (watchedSources.get(texture)?.source === source) watchedSources.delete(texture);
  };
  watchedSources.set(texture, { source, detach });
  texture.on("update", invalidate);
  texture.on("resize", invalidate);
  texture.once("destroy", detach);
}

export function getCardFinishSource(texture: Texture, optical = false): CardFinishSource | null {
  const source = sources.get(texture.source.resource as object);
  if (!source) return null;
  watchOpticalSource(source, texture.source);
  if (optical) {
    source.opticalFinish ??= {
      kind: isSemanticLayout(source.face) ? "raster" : "native",
      key: `manabrew-optical-finish:${source.id}`,
      document: cardOpticalDocument(
        0,
        0,
        source.face,
        source.tier,
        source.rulesText,
        source.palette,
      ),
      host: cardRasterHost(source.artUrls),
    };
    return source.opticalFinish;
  }
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
                return createImageBitmap(source.canvas);
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
    const recipe = magic.describe(source.face, source.tier === "table" ? "table" : "inspect");
    recipe.color = {
      ...recipe.color,
      key: JSON.stringify([recipe.color.key, source.width, source.height]),
      size: [source.width, source.height],
      async paint(_host, signal) {
        signal.throwIfAborted();
        return createImageBitmap(source.canvas);
      },
    };
    if (recipe.stamp) {
      const stamp = recipe.stamp;
      const key = JSON.stringify([stamp.key, source.width, source.height]);
      recipe.stamp = {
        ...stamp,
        key,
        size: [source.width, source.height],
        async paint(_host, signal) {
          const result = await composeCardOffThread(
            {
              key,
              face: source.face,
              printingId: null,
              artUrls: source.artUrls,
              rulesText: source.rulesText,
              tier: source.tier,
              palette: source.palette,
              etching: true,
            },
            signal,
          );
          return result.raster;
        },
      };
    }
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
  layers.artwork.destroy(true);
  layers.printing.destroy(true);
}

async function composeLayers(
  source: OpticalSource,
  signal: AbortSignal,
): Promise<CardOpticalLayers> {
  const key = `manabrew-optical:${source.id}:${source.tier}`;
  const result = await composeCardOffThread(
    {
      key,
      face: source.face,
      printingId: null,
      artUrls: source.artUrls,
      rulesText: source.rulesText,
      tier: source.tier,
      palette: source.palette,
      optical: true,
    },
    signal,
  );
  const rasters = [result.raster, result.printing];
  const textures: Texture[] = [];
  const owned: CardRaster[] = [];
  try {
    signal.throwIfAborted();
    if (!result.printing || result.key !== key)
      throw new Error("Card optical printing layers are unavailable");
    for (const raster of rasters) {
      if (!raster) continue;
      ownCardRaster(raster, raster.width * raster.height * 4);
      owned.push(raster);
      textures.push(createGeneratedCardTexture(raster));
    }
    return {
      artwork: textures[0]!,
      printing: textures[1]!,
      artWindows: getCardArtWindows(source.canvas),
      cornerRadius: source.cornerRadius,
    };
  } catch (error) {
    for (const texture of textures) texture.destroy(true);
    for (const raster of rasters) if (raster && !owned.includes(raster)) closeRaster(raster);
    throw error;
  } finally {
    for (const raster of owned) releaseCardRaster(raster);
  }
}

export function acquireCardOpticalLayers(
  texture: Texture,
  signal: AbortSignal,
): Promise<CardOpticalLease> | null {
  const source = sources.get(texture.source.resource as object);
  if (!source) return null;
  signal.throwIfAborted();
  watchOpticalSource(source, texture.source);
  let entry = source.entry;
  if (!entry) {
    const controller = new AbortController();
    const created: OpticalEntry = {
      refs: 0,
      controller,
      releaseSource: retainCardRaster(source.canvas),
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
      retained.releaseSource();
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
