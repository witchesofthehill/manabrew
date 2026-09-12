const CACHE_NAME = "manabrew-arena-images-v1";
const MAX_IMAGES = 512;
let writes = Promise.resolve();

function decodeImage(url: string, signal: AbortSignal, priority: boolean) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.fetchPriority = priority ? "high" : "low";
    const cleanup = () => {
      image.onload = image.onerror = null;
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      image.src = "";
      reject(new DOMException("Image loading aborted", "AbortError"));
    };
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error("Card image could not be decoded"));
    };
    image.src = url;
  });
}

async function decodeBlob(blob: Blob, signal: AbortSignal, priority: boolean) {
  const source = URL.createObjectURL(blob);
  try {
    return await decodeImage(source, signal, priority);
  } finally {
    URL.revokeObjectURL(source);
  }
}

function storeImage(cache: Cache, url: string, blob: Blob) {
  writes = writes
    .then(async () => {
      const keys = await cache.keys();
      const overflow = Math.max(0, keys.length - MAX_IMAGES + 1);
      for (const key of keys.slice(0, overflow)) await cache.delete(key);
      try {
        await cache.put(url, new Response(blob));
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== "QuotaExceededError") throw error;
        for (const key of keys.slice(overflow, overflow + 32)) await cache.delete(key);
        await cache.put(url, new Response(blob));
      }
    })
    .catch(() => {});
  return writes;
}

export async function persistentArenaImage(url: string, signal: AbortSignal, priority: boolean) {
  const remote = new URL(url, window.location.href);
  const eligible =
    remote.protocol === "https:" &&
    ["api.scryfall.com", "cards.scryfall.io"].includes(remote.hostname);
  if (!eligible) return decodeImage(url, signal, priority);
  let cache: Cache | undefined;
  try {
    cache = await caches.open(CACHE_NAME);
    const stored = await cache.match(url);
    if (stored) {
      try {
        return await decodeBlob(await stored.blob(), signal, priority);
      } catch (error) {
        if (signal.aborted) throw error;
        await cache.delete(url);
      }
    }
  } catch {
    if (signal.aborted) throw new DOMException("Image loading aborted", "AbortError");
  }
  if (!cache) return decodeImage(url, signal, priority);
  let blob: Blob;
  try {
    const response = await fetch(url, { signal, mode: "cors", credentials: "omit" });
    if (!response.ok) throw new Error(`Card image HTTP ${response.status}`);
    blob = await response.blob();
    if (!blob.type.startsWith("image/")) throw new Error("Not a card image");
  } catch (error) {
    if (signal.aborted) throw error;
    return decodeImage(url, signal, priority);
  }
  const image = await decodeBlob(blob, signal, priority);
  void storeImage(cache, url, blob);
  return image;
}
