import { canvasFontAssets } from "card-glint/magic/presentation";
import { setAssetFetcher } from "card-glint/canvas";
import { cachedCardGlintAsset } from "@/lib/cardGlintAssetCache";
import { platformFetch } from "@/lib/platformFetch";
import { loadScryfallImage } from "@/lib/scryfallImageSource";

const ART_FACE_FRAGMENT = "#manabrew-card-art-face=";
const loadedFonts = new Map<string, FontFace>();
let fonts: Promise<void> | undefined;

export async function resolveCardGlintAsset(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  options.signal?.throwIfAborted();
  const separator = url.lastIndexOf(ART_FACE_FRAGMENT);
  const source = separator < 0 ? url : url.slice(0, separator);
  let response = await cachedCardGlintAsset(source).catch(() => undefined);
  if (!response) {
    if (source.startsWith("blob:") || source.startsWith("data:")) {
      response = await fetch(source, options);
    } else if (source.startsWith("https://cards.scryfall.io/") && !options.signal) {
      response = await fetch(await loadScryfallImage(source));
    } else {
      response = await platformFetch(source, { ...options, mode: "cors" });
    }
  }
  if (!response.ok) throw new Error(`Card Glint asset HTTP ${response.status}: ${source}`);
  options.signal?.throwIfAborted();
  if (separator < 0) return response;
  const index = Number(url.slice(separator + ART_FACE_FRAGMENT.length));
  if (index !== 0 && index !== 1) throw new Error("Invalid multipart artwork face");
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const horizontal = bitmap.width >= bitmap.height;
    const extent = horizontal ? bitmap.width : bitmap.height;
    const start = index * Math.floor(extent / 2);
    const length = index === 0 ? Math.floor(extent / 2) : extent - start;
    const canvas = document.createElement("canvas");
    canvas.width = horizontal ? length : bitmap.width;
    canvas.height = horizontal ? bitmap.height : length;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Card artwork needs Canvas2D");
    context.drawImage(bitmap, horizontal ? -start : 0, horizontal ? 0 : -start);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value ? resolve(value) : reject(new Error("Card artwork could not be cropped")),
        "image/png",
      ),
    );
    options.signal?.throwIfAborted();
    return new Response(blob);
  } finally {
    bitmap.close();
  }
}

setAssetFetcher(resolveCardGlintAsset);

export function ensureCardGlintFonts(): Promise<void> {
  fonts ??= Promise.all(
    canvasFontAssets.map(async ({ family, url, weight, style }) => {
      if (loadedFonts.has(url)) return;
      const response = await resolveCardGlintAsset(url);
      const font = await new FontFace(family, await response.arrayBuffer(), {
        weight,
        style,
      }).load();
      document.fonts.add(font);
      loadedFonts.set(url, font);
    }),
  )
    .then(() => undefined)
    .catch((error: unknown) => {
      fonts = undefined;
      throw error;
    });
  return fonts;
}
