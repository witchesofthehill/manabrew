import { platformFetch } from "@/lib/platformFetch";

const SCRYFALL_IMAGE_HOSTS = new Set([
  "cards.scryfall.io",
  "backs.scryfall.io",
  "svgs.scryfall.io",
]);

export function isScryfallImageUrl(url: string): boolean {
  try {
    return SCRYFALL_IMAGE_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

function imageMimeFromUrl(url: string): string {
  const path = (url.split("?")[0] ?? "").toLowerCase();
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

export function peekScryfallImage(url: string): string | undefined {
  return cache.get(url);
}

export function clearScryfallImageCache(): void {
  for (const objectUrl of cache.values()) URL.revokeObjectURL(objectUrl);
  cache.clear();
  pending.clear();
}

// Fetches to a same-origin blob object URL. On desktop the webview runs under
// COEP: require-corp (SAB), which blocks cross-origin <img>; on web this also
// gives Pixi a WebGL-safe, CORS-clean texture source that can't be poisoned by
// the non-CORS display <img> cache entry for the same URL.
export function loadScryfallImage(url: string): Promise<string> {
  const cached = cache.get(url);
  if (cached) return Promise.resolve(cached);
  const inflight = pending.get(url);
  if (inflight) return inflight;
  const promise = (async () => {
    // cache: "reload" bypasses any non-CORS entry the display <img> cached for
    // this URL — a plain fetch would reuse it and CORS-fail (no ACAO header).
    const res = await platformFetch(url, { cache: "reload" });
    if (!res.ok) throw new Error(`scryfall image ${url}: HTTP ${res.status}`);
    const raw = await res.blob();
    const blob = raw.type.startsWith("image/")
      ? raw
      : new Blob([raw], { type: imageMimeFromUrl(url) });
    const objectUrl = URL.createObjectURL(blob);
    cache.set(url, objectUrl);
    return objectUrl;
  })().finally(() => pending.delete(url));
  pending.set(url, promise);
  return promise;
}
