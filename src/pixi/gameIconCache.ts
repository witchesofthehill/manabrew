import { Texture } from "pixi.js";
import { rasterizeSvgTexture } from "./assets/rasterizeSvgTexture";
import { resolveIconBody } from "./panelIcons";

/** Rasterized icons (via `panelIcons.resolveIconBody` — hand-picked registry
 *  first, iconify game-icons pack second) as white Pixi textures, tint at the
 *  sprite. Mirrors `manaSymbolCache`'s SVG→canvas approach so Pixi gets a
 *  concrete texture (SVG images can decode with zero intrinsic size). */
const RASTER_SIZE = 128;
const textures = new Map<string, Texture>();
const loading = new Map<string, Promise<Texture>>();

function svgFor(name: string): string | null {
  const icon = resolveIconBody(name);
  if (!icon) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${icon.width} ${icon.height}" fill="#ffffff" style="color:#ffffff">${icon.body.replaceAll("currentColor", "#ffffff")}</svg>`;
}

export function gameIconTexture(name: string): Promise<Texture> {
  const cached = textures.get(name);
  if (cached && !cached.destroyed) return Promise.resolve(cached);
  if (cached) textures.delete(name);
  const inFlight = loading.get(name);
  if (inFlight) return inFlight;

  const svg = svgFor(name);
  if (!svg) return Promise.reject(new Error(`unknown game-icon: ${name}`));

  const promise = rasterizeSvgTexture(svg, RASTER_SIZE)
    .then((texture) => {
      textures.set(name, texture);
      return texture;
    })
    .finally(() => loading.delete(name));
  loading.set(name, promise);
  return promise;
}
