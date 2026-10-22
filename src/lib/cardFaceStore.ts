import { APP_VERSION } from "@/lib/constants";
import { offlineCacheAvailable } from "@/lib/cardGlintAssetCache";
import type { CardRaster } from "@/lib/cardRenderTypes";

const STORE_PREFIX = "manabrew-card-faces-";
const STORE_NAME = `${STORE_PREFIX}${APP_VERSION}`;
const MAX_STORED_FACES = 1500;
const TRIM_EVERY_WRITES = 50;
const FACE_QUALITY = 0.92;

const counters = { storeHits: 0, storeMisses: 0, storeWrites: 0, storeFailures: 0 };
let store: Promise<Cache> | null = null;
let generation = 0;
let writes = 0;

function enabled(): boolean {
  return (
    !import.meta.env.DEV &&
    offlineCacheAvailable() &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof crypto?.subtle !== "undefined"
  );
}

function openStore(): Promise<Cache> {
  store ??= (async () => {
    for (const name of await caches.keys())
      if (name.startsWith(STORE_PREFIX) && name !== STORE_NAME) void caches.delete(name);
    return caches.open(STORE_NAME);
  })();
  return store;
}

async function faceUrl(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0"));
  return new URL(`/__card-faces/${hash.join("")}`, location.origin).href;
}

export async function readStoredCardFace(key: string): Promise<ImageBitmap | undefined> {
  if (!enabled()) return undefined;
  const started = generation;
  try {
    const response = await (await openStore()).match(await faceUrl(key));
    if (!response || started !== generation) {
      counters.storeMisses++;
      return undefined;
    }
    const bitmap = await createImageBitmap(await response.blob());
    if (started !== generation) {
      bitmap.close();
      return undefined;
    }
    counters.storeHits++;
    return bitmap;
  } catch {
    counters.storeFailures++;
    return undefined;
  }
}

export function storeCardFace(key: string, raster: CardRaster): void {
  if (!enabled()) return;
  const started = generation;
  let canvas: OffscreenCanvas;
  try {
    canvas = new OffscreenCanvas(raster.width, raster.height);
    canvas.getContext("2d")!.drawImage(raster, 0, 0);
  } catch {
    counters.storeFailures++;
    return;
  }
  void (async () => {
    const blob = await canvas.convertToBlob({ type: "image/webp", quality: FACE_QUALITY });
    const [cache, url] = await Promise.all([openStore(), faceUrl(key)]);
    if (started !== generation) return;
    await cache.put(url, new Response(blob, { headers: { "content-type": blob.type } }));
    counters.storeWrites++;
    if (++writes % TRIM_EVERY_WRITES !== 0) return;
    const keys = await cache.keys();
    await Promise.all(
      keys
        .slice(0, Math.max(0, keys.length - MAX_STORED_FACES))
        .map((request) => cache.delete(request)),
    );
  })().catch(() => {
    counters.storeFailures++;
  });
}

export function clearStoredCardFaces(): void {
  generation++;
  store = null;
  if (enabled()) void caches.delete(STORE_NAME);
}

export function cardFaceStoreStats() {
  return { ...counters };
}

export function resetCardFaceStoreStats(): void {
  for (const key of Object.keys(counters) as (keyof typeof counters)[]) counters[key] = 0;
}
