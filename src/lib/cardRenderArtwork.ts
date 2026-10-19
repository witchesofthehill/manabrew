import { loadCanvasImages } from "card-glint/magic/presentation";
import { loadScryfallImage } from "@/lib/scryfallImageSource";

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

async function decodeArtwork(url: string): Promise<ImageLease> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = await loadScryfallImage(url);
  await image.decode();
  const bitmap = await createImageBitmap(image);
  return { images: new Map([[url, bitmap]]), dispose: () => bitmap.close() };
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
