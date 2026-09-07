import { Texture } from "pixi.js";
import { platformFetch } from "@/lib/platformFetch";
import { getPlatformType } from "@/platform";
import { MANA_CODE_FILE_OVERRIDES, type ManaCode } from "@/types/scryfall";
import { rasterizeSvgTexture } from "./assets/rasterizeSvgTexture";

const CONFIGURED_SYMBOL_BASE = import.meta.env.VITE_SCRYFALL_SYMBOL_BASE;
const REMOTE_SYMBOL_BASE = "https://svgs.scryfall.io/card-symbols/";
const WEB_SYMBOL_BASE = "/scryfall-symbols/";
// Rasterize SVGs into a fixed-size canvas so Pixi gets a concrete texture
// (SVGs decoded into HTMLImageElement can have zero intrinsic dimensions).
const SYMBOL_RASTER_SIZE = 96;

const textures = new Map<string, Texture>();
const loading = new Map<string, Promise<Texture>>();
let cacheGeneration = 0;

async function fetchSvgText(symbol: string): Promise<string> {
  const base =
    CONFIGURED_SYMBOL_BASE ||
    (getPlatformType() === "tauri" ? REMOTE_SYMBOL_BASE : WEB_SYMBOL_BASE);
  const filename = MANA_CODE_FILE_OVERRIDES[symbol as ManaCode] ?? symbol.replaceAll("/", "");
  const url = `${base}${encodeURIComponent(filename)}.svg`;
  const response = await platformFetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return await response.text();
}

async function loadSymbolTexture(symbol: string): Promise<Texture> {
  const svgText = await fetchSvgText(symbol);
  return await rasterizeSvgTexture(svgText, SYMBOL_RASTER_SIZE);
}

export function getManaSymbolTextureSync(symbol: string): Texture | null {
  const cached = textures.get(symbol);
  return cached && !cached.destroyed ? cached : null;
}

export function loadManaSymbolTexture(symbol: string): Promise<Texture> {
  const cached = getManaSymbolTextureSync(symbol);
  if (cached) return Promise.resolve(cached);
  const pending = loading.get(symbol);
  if (pending) return pending;

  const generation = cacheGeneration;
  const promise = loadSymbolTexture(symbol)
    .then((texture) => {
      if (generation === cacheGeneration) textures.set(symbol, texture);
      return texture;
    })
    .finally(() => {
      if (loading.get(symbol) === promise) loading.delete(symbol);
    });
  loading.set(symbol, promise);
  return promise;
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
  cacheGeneration += 1;
  for (const tex of textures.values()) tex.destroy(true);
  textures.clear();
  loading.clear();
}
