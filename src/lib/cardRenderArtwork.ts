import { loadCanvasImages } from "card-glint/magic/presentation";
import { decodeCanvasImage } from "card-glint/canvas";
import { resolveCardGlintAsset } from "@/lib/cardGlintAssets";

const MAX_ARTWORK_BYTES = 32 * 1024 * 1024;
interface ImageLease {
  images: Map<string, ImageBitmap>;
  dispose: () => void;
}
interface AcquiredImage {
  lease: ImageLease;
  release: () => void;
}
interface ImageEntry {
  refs: number;
  bytes: number;
  promise: Promise<ImageLease>;
  lease?: ImageLease;
}
const images = new Map<string, ImageEntry>();
let imageBytes = 0;
type CardImageBridge = (
  url: string,
  artwork: boolean,
  signal: AbortSignal,
  blob?: Blob,
) => Promise<Map<string, ImageBitmap>>;
let imageBridge: CardImageBridge | undefined;

export function setCardImageBridge(bridge: CardImageBridge): void {
  imageBridge = bridge;
}

async function bridgedImages(url: string, artwork: boolean, blob?: Blob): Promise<ImageLease> {
  if (!imageBridge) throw new Error("Card image bridge is unavailable");
  const loaded = await imageBridge(url, artwork, new AbortController().signal, blob);
  return {
    images: loaded,
    dispose: () => {
      for (const image of new Set(loaded.values())) image.close();
      loaded.clear();
    },
  };
}

async function decodeArtwork(url: string): Promise<ImageLease> {
  const blob = await (await resolveCardGlintAsset(url)).blob();
  if (imageBridge && blob.type.includes("svg")) return bridgedImages(url, true, blob);
  const bitmap = await decodeCanvasImage(blob, new AbortController().signal);
  return { images: new Map([[url, bitmap]]), dispose: () => bitmap.close() };
}

export function cardArtworkStats() {
  let activeArtworkBytes = 0;
  for (const entry of images.values()) if (entry.refs) activeArtworkBytes += entry.bytes;
  return { artworkBytes: imageBytes, activeArtworkBytes, decodedArtwork: images.size };
}

export function clearCardArtworkCache(): void {
  for (const [url, entry] of images) {
    if (entry.refs || !entry.lease) continue;
    images.delete(url);
    imageBytes -= entry.bytes;
    entry.lease.dispose();
  }
}

function trimImages(): void {
  for (const [url, entry] of images) {
    if (imageBytes <= MAX_ARTWORK_BYTES) break;
    if (entry.refs || !entry.lease) continue;
    images.delete(url);
    imageBytes -= entry.bytes;
    entry.lease.dispose();
  }
}

async function acquireImage(url: string, artwork: boolean): Promise<AcquiredImage> {
  let entry = images.get(url);
  if (entry) {
    images.delete(url);
    images.set(url, entry);
  } else {
    const created: ImageEntry = {
      refs: 0,
      bytes: 0,
      promise: Promise.resolve()
        .then(async () => {
          const lease = artwork
            ? await decodeArtwork(url)
            : imageBridge
              ? await bridgedImages(url, false)
              : await loadCanvasImages([url], new AbortController().signal);
          if (!lease.images.get(url)) {
            lease.dispose();
            throw new Error(`Card composition asset unavailable: ${url}`);
          }
          created.lease = lease;
          created.bytes = [...new Set(lease.images.values())].reduce(
            (sum, image) => sum + image.width * image.height * 4,
            0,
          );
          imageBytes += created.bytes;
          return lease;
        })
        .catch((error: unknown) => {
          images.delete(url);
          throw error;
        }),
    };
    entry = created;
    images.set(url, created);
  }
  entry.refs += 1;
  const retained = entry;
  try {
    const lease = await retained.promise;
    let released = false;
    return {
      lease,
      release: () => {
        if (released) return;
        released = true;
        retained.refs -= 1;
        trimImages();
      },
    };
  } catch (error) {
    retained.refs -= 1;
    throw error;
  }
}

export function cardImageLoader(artUrls: readonly (string | undefined)[]): typeof loadCanvasImages {
  const artwork = new Set(artUrls.filter((url): url is string => Boolean(url)));
  return async (urls, signal) => {
    const requested = [...new Set(urls.filter((url): url is string => Boolean(url)))];
    const leases: AcquiredImage[] = [];
    let index = 0;
    const settled = await Promise.allSettled(
      Array.from({ length: Math.min(4, requested.length) }, async () => {
        while (index < requested.length) {
          signal.throwIfAborted();
          const url = requested[index++]!;
          leases.push(await acquireImage(url, artwork.has(url)));
        }
      }),
    );
    const dispose = () => leases.forEach((lease) => lease.release());
    const failure = settled.find((result) => result.status === "rejected");
    if (failure?.status === "rejected" || signal.aborted) {
      dispose();
      throw failure?.status === "rejected" ? failure.reason : signal.reason;
    }
    const loaded = new Map<string, ImageBitmap>();
    for (const entry of leases)
      for (const [url, image] of entry.lease.images) loaded.set(url, image);
    return { images: loaded, dispose };
  };
}
