import { canvasFontAssets } from "card-glint/magic/presentation";
import { setAssetFetcher } from "card-glint/canvas";

type AssetResolver = (url: string, options?: RequestInit) => Promise<Response>;
interface FontRealm {
  fonts: FontFaceSet;
}
let assetResolver: AssetResolver | undefined;

export function setCardGlintAssetResolver(resolve: AssetResolver): void {
  assetResolver = resolve;
}

async function platformAsset(url: string, options: RequestInit): Promise<Response> {
  const [{ cachedCardGlintAsset }, { platformFetch }, { loadScryfallImage }] = await Promise.all([
    import("@/lib/cardGlintAssetCache"),
    import("@/lib/platformFetch"),
    import("@/lib/scryfallImageSource"),
  ]);
  const cached = await cachedCardGlintAsset(url).catch(() => undefined);
  if (cached) return cached;
  if (url.startsWith("blob:") || url.startsWith("data:")) return fetch(url, options);
  if (url.startsWith("https://cards.scryfall.io/"))
    return fetch(await loadScryfallImage(url), { signal: options.signal });
  return platformFetch(url, { ...options, mode: "cors" });
}

let fonts: Promise<void> | undefined;

export async function resolveCardGlintAsset(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  options.signal?.throwIfAborted();
  const response = await (assetResolver ?? platformAsset)(url, options);
  if (!response.ok) throw new Error(`Card Glint asset HTTP ${response.status}: ${url}`);
  options.signal?.throwIfAborted();
  return response;
}

setAssetFetcher(resolveCardGlintAsset);

export interface CardGlintFontAsset {
  family: string;
  url: string;
  weight: string;
  style: string;
}

const pendingFonts = new Map<string, Promise<void>>();

export function ensureCardGlintFont(asset: CardGlintFontAsset): Promise<void> {
  const { family, url, weight, style } = asset;
  const key = JSON.stringify([url, family, weight, style]);
  let pending = pendingFonts.get(key);
  if (!pending) {
    pending = (async () => {
      const response = await resolveCardGlintAsset(url);
      const font = await new FontFace(family, await response.arrayBuffer(), {
        weight,
        style,
      }).load();
      const realm = globalThis as unknown as FontRealm;
      const registry = typeof document === "undefined" ? realm.fonts : document.fonts;
      registry.add(font);
    })().catch((error: unknown) => {
      pendingFonts.delete(key);
      throw error;
    });
    pendingFonts.set(key, pending);
  }
  return pending;
}

export function ensureCardGlintFonts(): Promise<void> {
  fonts ??= Promise.all(canvasFontAssets.map(ensureCardGlintFont))
    .then(() => undefined)
    .catch((error: unknown) => {
      fonts = undefined;
      throw error;
    });
  return fonts;
}
