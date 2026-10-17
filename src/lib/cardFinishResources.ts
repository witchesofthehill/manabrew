import { FinishResources } from "card-glint/finish";
import { CanvasSource, Texture } from "pixi.js";
import type { TextureSource } from "pixi.js";
import { ensureCardGlintFonts } from "@/lib/cardGlintAssets";
import { getCardFinishSource } from "@/lib/cardOpticalLayers";
import type { CardFinishSource } from "@/lib/cardOpticalLayers";

export interface CardFinishMaskLease {
  texture: Texture;
  release(): void;
}

export interface CardFinishCausticsLease extends CardFinishMaskLease {
  update(time: number): void;
}

type ArtworkSource = HTMLCanvasElement | OffscreenCanvas | HTMLImageElement | ImageBitmap;

interface ArtworkMasks {
  resource: ArtworkSource;
  revision: number;
  sources: Map<TextureSource, () => void>;
  entries: Map<string, MaskEntry>;
}

interface MaskEntry {
  artwork: ArtworkMasks;
  key: string;
  revision: number;
  generation: number;
  imageUrl: string;
  width: number;
  height: number;
  bytes: number;
  refs: number;
  texture: Texture | null;
  canvas: HTMLCanvasElement | null;
  ready: Promise<Texture>;
  disposed: boolean;
  controller: AbortController;
  native: CardFinishSource | null;
}

interface CausticsEntry {
  texture: Texture;
  refs: number;
  time: number;
}

const MAX_MASK_EDGE = 1024;
const MAX_IDLE_MASKS = 24;
const MAX_IDLE_MASK_BYTES = 32 * 1024 * 1024;
const MASK_BYTES_PER_PIXEL = 4;
const artworkMasks = new WeakMap<ArtworkSource, ArtworkMasks>();
const idleMasks = new Set<MaskEntry>();
let idleMaskBytes = 0;
let leaseCount = 0;
let maskGeneration = 0;
let resources: FinishResources | null = null;
let caustics: CausticsEntry | null = null;

function finishResources(): FinishResources {
  resources ??= new FinishResources();
  return resources;
}

function isArtworkSource(resource: unknown): resource is ArtworkSource {
  return (
    (typeof HTMLCanvasElement !== "undefined" && resource instanceof HTMLCanvasElement) ||
    (typeof OffscreenCanvas !== "undefined" && resource instanceof OffscreenCanvas) ||
    (typeof HTMLImageElement !== "undefined" && resource instanceof HTMLImageElement) ||
    (typeof ImageBitmap !== "undefined" && resource instanceof ImageBitmap)
  );
}

function isImage(resource: ArtworkSource): resource is HTMLImageElement {
  return typeof HTMLImageElement !== "undefined" && resource instanceof HTMLImageElement;
}

function watchSource(artwork: ArtworkMasks, source: TextureSource): void {
  if (artwork.sources.has(source)) return;
  const update = () => {
    artwork.revision += 1;
  };
  const detach = () => {
    source.off("update", update);
    source.off("resize", update);
    source.off("destroy", detach);
    artwork.sources.delete(source);
  };
  artwork.sources.set(source, detach);
  source.on("update", update);
  source.on("resize", update);
  source.once("destroy", detach);
}

function removeIdleMask(entry: MaskEntry): void {
  if (idleMasks.delete(entry)) idleMaskBytes -= entry.bytes;
}

function destroyMask(entry: MaskEntry): void {
  if (entry.disposed) return;
  entry.disposed = true;
  entry.controller.abort();
  removeIdleMask(entry);
  entry.artwork.entries.delete(entry.key);
  entry.texture?.destroy(true);
  entry.texture = null;
  if (entry.canvas) {
    entry.canvas.width = 1;
    entry.canvas.height = 1;
    entry.canvas = null;
  }
  if (!entry.artwork.entries.size) {
    for (const detach of entry.artwork.sources.values()) detach();
    artworkMasks.delete(entry.artwork.resource);
  }
}

function disposeUnusedResources(): void {
  if (leaseCount) return;
  for (const entry of idleMasks) destroyMask(entry);
  resources?.dispose();
  resources = null;
}

function releaseMask(entry: MaskEntry): void {
  entry.refs -= 1;
  leaseCount -= 1;
  if (!entry.refs) {
    if (entry.texture) {
      idleMasks.add(entry);
      idleMaskBytes += entry.bytes;
      while (idleMasks.size > MAX_IDLE_MASKS || idleMaskBytes > MAX_IDLE_MASK_BYTES) {
        const oldest = idleMasks.values().next().value;
        if (!oldest) break;
        destroyMask(oldest);
      }
    } else {
      destroyMask(entry);
    }
  }
  disposeUnusedResources();
}

function canvasTexture(canvas: HTMLCanvasElement, repeat = false): Texture {
  const source = new CanvasSource({
    resource: canvas,
    width: canvas.width,
    height: canvas.height,
    resolution: 1,
    format: "rgba8unorm",
    alphaMode: "no-premultiply-alpha",
    scaleMode: "linear",
    addressMode: repeat ? "repeat" : "clamp-to-edge",
    autoGenerateMipmaps: false,
  });
  return new Texture({ source });
}

async function createMask(entry: MaskEntry): Promise<Texture> {
  if (entry.disposed || !entry.refs) {
    throw new DOMException("Card finish mask acquisition cancelled", "AbortError");
  }
  const { artwork } = entry;
  const resource = artwork.resource;
  const image = isImage(resource) ? resource : null;
  const width = image ? image.naturalWidth : resource.width;
  const height = image ? image.naturalHeight : resource.height;
  const url = image ? image.currentSrc || image.src : "";
  if (
    artwork.revision !== entry.revision ||
    width !== entry.width ||
    height !== entry.height ||
    url !== entry.imageUrl
  ) {
    throw new Error("Card artwork changed before its finish mask was generated");
  }
  if (entry.native) {
    await ensureCardGlintFonts();
    entry.controller.signal.throwIfAborted();
    const document =
      entry.native.kind === "raster"
        ? {
            ...entry.native.document,
            recipe: {
              ...entry.native.document.recipe,
              edges: entry.native.document.recipe.edges.map((edge) => ({
                ...edge,
                asset: { ...edge.asset, revision: String(entry.generation) },
              })),
            },
          }
        : entry.native.document;
    const canvas = await finishResources().documentMask(
      document,
      entry.native.host,
      entry.controller.signal,
    );
    try {
      entry.controller.signal.throwIfAborted();
      if (
        artwork.revision !== entry.revision ||
        (image ? image.naturalWidth : resource.width) !== entry.width ||
        (image ? image.naturalHeight : resource.height) !== entry.height ||
        (image ? image.currentSrc || image.src : "") !== entry.imageUrl
      ) {
        throw new Error("Card artwork changed before its finish mask was generated");
      }
      entry.texture = canvasTexture(canvas);
      entry.canvas = canvas;
      entry.bytes = canvas.width * canvas.height * MASK_BYTES_PER_PIXEL;
      return entry.texture;
    } catch (error) {
      canvas.width = canvas.height = 0;
      throw error;
    }
  }
  const scale = Math.min(1, MAX_MASK_EDGE / Math.max(width, height));
  const maskWidth = Math.max(1, Math.round(width * scale));
  const maskHeight = Math.max(1, Math.round(height * scale));
  let resized: HTMLCanvasElement | null = null;
  try {
    let input: ArtworkSource = artwork.resource;
    if (scale < 1) {
      resized = document.createElement("canvas");
      resized.width = maskWidth;
      resized.height = maskHeight;
      const context = resized.getContext("2d");
      if (!context) throw new Error("Card finish mask resizing requires a 2D canvas context");
      context.drawImage(input, 0, 0, maskWidth, maskHeight);
      input = resized;
    }
    entry.canvas = finishResources().mask(input, maskWidth, maskHeight);
    entry.texture = canvasTexture(entry.canvas);
    entry.bytes = maskWidth * maskHeight * MASK_BYTES_PER_PIXEL;
    return entry.texture;
  } finally {
    if (resized) {
      resized.width = 1;
      resized.height = 1;
    }
  }
}

export async function acquireCardFinishMask(
  texture: Texture,
  signal?: AbortSignal,
): Promise<CardFinishMaskLease> {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Card finish mask acquisition cancelled", "AbortError");
  }
  if (texture.destroyed || !texture.source || texture.source.destroyed) {
    throw new Error("Cannot generate a finish mask for a destroyed card texture");
  }
  const source = texture.source;
  const resource: unknown = source.resource;
  if (!isArtworkSource(resource)) {
    throw new Error("Card finish masks require drawable image, bitmap, or canvas artwork");
  }
  const image = isImage(resource) ? resource : null;
  const width = image ? image.naturalWidth : resource.width;
  const height = image ? image.naturalHeight : resource.height;
  if (!width || !height || (image && !image.complete)) {
    throw new Error("Card artwork must be loaded before generating a finish mask");
  }
  const native = getCardFinishSource(texture);
  let artwork = artworkMasks.get(resource);
  if (!artwork) {
    artwork = { resource, revision: 0, sources: new Map(), entries: new Map() };
    artworkMasks.set(resource, artwork);
  }
  watchSource(artwork, source);
  const url = image ? image.currentSrc || image.src : "";
  const key = JSON.stringify([
    width,
    height,
    source.pixelWidth,
    source.pixelHeight,
    artwork.revision,
    url,
    native?.key,
  ]);
  let entry = artwork.entries.get(key);
  if (!entry) {
    const pending: MaskEntry = {
      artwork,
      key,
      revision: artwork.revision,
      generation: ++maskGeneration,
      imageUrl: url,
      width,
      height,
      bytes: 0,
      refs: 0,
      texture: null,
      canvas: null,
      ready: Promise.resolve().then(() => createMask(pending)),
      disposed: false,
      controller: new AbortController(),
      native,
    };
    artwork.entries.set(key, pending);
    entry = pending;
  }
  const mask = entry;
  removeIdleMask(mask);
  mask.refs += 1;
  leaseCount += 1;
  return new Promise<CardFinishMaskLease>((resolve, reject) => {
    let settled = false;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      releaseMask(mask);
    };
    const detach = () => {
      signal?.removeEventListener("abort", abort);
      texture.off("destroy", destroyed);
      source.off("destroy", destroyed);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      detach();
      release();
      reject(error);
    };
    const abort = () => {
      fail(
        signal?.reason ?? new DOMException("Card finish mask acquisition cancelled", "AbortError"),
      );
    };
    const destroyed = () => {
      fail(new Error("Card texture was destroyed before its finish mask was acquired"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    texture.once("destroy", destroyed);
    source.once("destroy", destroyed);
    void mask.ready.then((maskTexture) => {
      if (settled) return;
      settled = true;
      detach();
      resolve({ texture: maskTexture, release });
    }, fail);
  });
}

export function acquireCardFinishCaustics(): CardFinishCausticsLease {
  if (!caustics) {
    try {
      caustics = { texture: canvasTexture(finishResources().caustics(0), true), refs: 0, time: 0 };
    } catch (error) {
      disposeUnusedResources();
      throw error;
    }
  }
  const entry = caustics;
  entry.refs += 1;
  leaseCount += 1;
  let released = false;
  return {
    texture: entry.texture,
    update(time) {
      if (released || entry.time === time) return;
      finishResources().caustics(time);
      entry.texture.source.update();
      entry.time = time;
    },
    release() {
      if (released) return;
      released = true;
      entry.refs -= 1;
      leaseCount -= 1;
      if (!entry.refs) {
        entry.texture.destroy(true);
        caustics = null;
      }
      disposeUnusedResources();
    },
  };
}
