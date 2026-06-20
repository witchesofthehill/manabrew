import { Texture, ImageSource } from "pixi.js";
import { platformFetch } from "@/lib/platformFetch";

const SCRYFALL_SYMBOL_BASE =
  import.meta.env.VITE_SCRYFALL_SYMBOL_BASE || "https://svgs.scryfall.io/card-symbols/";
// Rasterize SVGs into a fixed-size canvas so Pixi gets a concrete texture
// (SVGs decoded into HTMLImageElement can have zero intrinsic dimensions).
const SYMBOL_RASTER_SIZE = 96;

const textures = new Map<string, Texture>();
const loading = new Map<string, Promise<Texture>>();

async function fetchSvgText(symbol: string): Promise<string> {
  const url = `${SCRYFALL_SYMBOL_BASE}${encodeURIComponent(symbol)}.svg`;
  const response = await platformFetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return await response.text();
}

async function rasterizeSvg(svgText: string): Promise<HTMLCanvasElement> {
  const blob = new Blob([svgText], { type: "image/svg+xml" });
  const blobUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.width = SYMBOL_RASTER_SIZE;
      image.height = SYMBOL_RASTER_SIZE;
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("svg decode failed"));
      image.src = blobUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = SYMBOL_RASTER_SIZE;
    canvas.height = SYMBOL_RASTER_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    ctx.clearRect(0, 0, SYMBOL_RASTER_SIZE, SYMBOL_RASTER_SIZE);
    ctx.drawImage(img, 0, 0, SYMBOL_RASTER_SIZE, SYMBOL_RASTER_SIZE);
    return canvas;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

async function loadSymbolTexture(symbol: string): Promise<Texture> {
  const svgText = await fetchSvgText(symbol);
  const canvas = await rasterizeSvg(svgText);
  const source = new ImageSource({ resource: canvas });
  const tex = new Texture({ source });
  textures.set(symbol, tex);
  return tex;
}

/** Returns a cached mana-symbol texture, or null if it isn't loaded yet. */
export function getManaSymbolTextureSync(symbol: string): Texture | null {
  const cached = textures.get(symbol);
  return cached && !cached.destroyed ? cached : null;
}

/** Kicks off a load for the given symbol; resolves to its texture. */
export function loadManaSymbolTexture(symbol: string): Promise<Texture> {
  const cached = getManaSymbolTextureSync(symbol);
  if (cached) return Promise.resolve(cached);
  const pending = loading.get(symbol);
  if (pending) return pending;
  const p = loadSymbolTexture(symbol).finally(() => loading.delete(symbol));
  loading.set(symbol, p);
  return p;
}

/** Pre-warm the five colors, colorless, plus tap/untap so first hover
 * renders from cache. Scryfall hosts all card symbols at the same path.
 */
export function prewarmManaSymbols(): void {
  for (const s of ["W", "U", "B", "R", "G", "C", "T", "Q"]) {
    loadManaSymbolTexture(s).catch((err) =>
      console.warn(`[pixi] card symbol load failed for {${s}}:`, err),
    );
  }
}

export function clearManaSymbolCache(): void {
  for (const tex of textures.values()) tex.destroy(true);
  textures.clear();
  loading.clear();
}
