import { platformFetch } from "@/lib/platformFetch";
import { lanArtUrl } from "@/lib/lanArtHost";
import { getPlatform, getPlatformType } from "@/platform";

const SCRYFALL_IMAGE_CDN_ORIGIN = "https://cards.scryfall.io/";

const SCRYFALL_IMAGE_HOSTS = new Set([
  "cards.scryfall.io",
  "backs.scryfall.io",
  "svgs.scryfall.io",
]);

/**
 * The path below the CDN origin, which is what the desktop cache and the LAN
 * listener both key on. Only `cards.scryfall.io` is cached; the mana-symbol and
 * card-back hosts are small and rarely change.
 */
export function cacheKeyForImage(url: string): string | null {
  if (!url.startsWith(SCRYFALL_IMAGE_CDN_ORIGIN)) return null;
  const key = url.slice(SCRYFALL_IMAGE_CDN_ORIGIN.length).split(/[?#]/)[0];
  return key || null;
}

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

/**
 * Whether this build serves `/scryfall-img/`, asked of the shell rather than
 * inferred from the platform. Windows keeps Tauri's embedded scheme and runs no
 * asset server, and that scheme answers any unknown path with `index.html` and
 * a 200, so an unguarded fetch of the route "succeeds" with HTML where an image
 * was expected. Dev hands the path to vite's proxy and serves no cache either.
 */
let localCardArtRoute: Promise<boolean> | null = null;

export function localCardArtRouteAvailable(): Promise<boolean> {
  if (getPlatformType() !== "tauri") return Promise.resolve(false);
  localCardArtRoute ??= getPlatform()
    .invoke<boolean>("card_art_route_available")
    .catch(() => false);
  return localCardArtRoute;
}

// Fetches to a same-origin blob object URL. On desktop the webview runs under
// COEP: require-corp (SAB), which blocks cross-origin <img>; on web this also
// gives Pixi a WebGL-safe, CORS-clean texture source that can't be poisoned by
// the non-CORS display <img> cache entry for the same URL.
/**
 * Nearest source first: this machine's own cache, then a host on this network
 * that already downloaded it, then the CDN. The first two are plain same-scheme
 * http and need no CORS dance; the CDN sends no `access-control-allow-origin`,
 * which is why it goes through the native fetch.
 */
async function fetchImageBytes(url: string): Promise<Blob> {
  const key = cacheKeyForImage(url);
  if (key) {
    const local = (await localCardArtRouteAvailable()) ? `/scryfall-img/${key}` : null;
    for (const candidate of [local, lanArtUrl(key)]) {
      if (!candidate) continue;
      try {
        const res = await fetch(candidate);
        if (res.ok) return await res.blob();
      } catch {
        // Offline, or no such host: the next source gets a turn.
      }
    }
  }
  // cache: "reload" bypasses any non-CORS entry the display <img> cached for
  // this URL — a plain fetch would reuse it and CORS-fail (no ACAO header).
  const res = await platformFetch(url, { cache: "reload" });
  if (!res.ok) throw new Error(`scryfall image ${url}: HTTP ${res.status}`);
  return await res.blob();
}

export function loadScryfallImage(url: string): Promise<string> {
  const cached = cache.get(url);
  if (cached) return Promise.resolve(cached);
  const inflight = pending.get(url);
  if (inflight) return inflight;
  const promise = (async () => {
    const raw = await fetchImageBytes(url);
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
