import { canvasFontAssets, retroFontAssets } from "card-glint/magic/presentation";
import { setAssetFetcher } from "card-glint/canvas";
import type { CanvasRaster } from "card-glint/canvas";
import { createCardScratchCanvas, closeCardScratchCanvas } from "@/lib/cardRasterScratch";

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

const ART_FACE_FRAGMENT = "#manabrew-card-art-face=";
let fonts: Promise<void> | undefined;

export async function resolveCardGlintAsset(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  options.signal?.throwIfAborted();
  const separator = url.lastIndexOf(ART_FACE_FRAGMENT);
  const source = separator < 0 ? url : url.slice(0, separator);
  const response = await (assetResolver ?? platformAsset)(source, options);
  if (!response.ok) throw new Error(`Card Glint asset HTTP ${response.status}: ${source}`);
  options.signal?.throwIfAborted();
  if (separator < 0) return response;
  const index = Number(url.slice(separator + ART_FACE_FRAGMENT.length));
  if (index !== 0 && index !== 1) throw new Error("Invalid multipart artwork face");
  const bitmap = await createImageBitmap(await response.blob());
  let canvas: CanvasRaster | undefined;
  try {
    const horizontal = bitmap.width >= bitmap.height;
    const extent = horizontal ? bitmap.width : bitmap.height;
    const start = index * Math.floor(extent / 2);
    const length = index === 0 ? Math.floor(extent / 2) : extent - start;
    canvas = createCardScratchCanvas(
      horizontal ? length : bitmap.width,
      horizontal ? bitmap.height : length,
    );
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Card artwork needs Canvas2D");
    context.drawImage(bitmap, horizontal ? -start : 0, horizontal ? 0 : -start);
    const output = canvas;
    const blob =
      "convertToBlob" in output
        ? await output.convertToBlob({ type: "image/png" })
        : await new Promise<Blob>((resolve, reject) =>
            output.toBlob(
              (value) =>
                value ? resolve(value) : reject(new Error("Card artwork could not be cropped")),
              "image/png",
            ),
          );
    options.signal?.throwIfAborted();
    return new Response(blob);
  } finally {
    if (canvas) closeCardScratchCanvas(canvas);
    bitmap.close();
  }
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
  fonts ??= Promise.all([...canvasFontAssets, ...retroFontAssets].map(ensureCardGlintFont))
    .then(() => undefined)
    .catch((error: unknown) => {
      fonts = undefined;
      throw error;
    });
  return fonts;
}
