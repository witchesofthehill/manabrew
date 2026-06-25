import { Texture, ImageSource } from "pixi.js";
import { icons as gameIcons } from "@iconify-json/game-icons";

/** Rasterized game-icons (`@iconify-json/game-icons`) as white Pixi textures,
 *  tint at the sprite. Mirrors `manaSymbolCache`'s SVG→canvas approach so Pixi
 *  gets a concrete texture (SVG images can decode with zero intrinsic size). */
const RASTER_SIZE = 128;
const textures = new Map<string, Texture>();
const loading = new Map<string, Promise<Texture>>();

function svgFor(name: string): string | null {
  const icon = gameIcons.icons[name as keyof typeof gameIcons.icons];
  if (!icon) return null;
  const w = icon.width ?? gameIcons.width ?? 512;
  const h = icon.height ?? gameIcons.height ?? 512;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" fill="#ffffff" style="color:#ffffff">${icon.body}</svg>`;
}

export function gameIconTexture(name: string): Promise<Texture> {
  const cached = textures.get(name);
  if (cached) return Promise.resolve(cached);
  const inFlight = loading.get(name);
  if (inFlight) return inFlight;

  const svg = svgFor(name);
  if (!svg) return Promise.reject(new Error(`unknown game-icon: ${name}`));

  const promise = new Promise<Texture>((resolve, reject) => {
    const blobUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const image = new Image();
    image.width = RASTER_SIZE;
    image.height = RASTER_SIZE;
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = RASTER_SIZE;
      canvas.height = RASTER_SIZE;
      const ctx = canvas.getContext("2d");
      URL.revokeObjectURL(blobUrl);
      if (!ctx) return reject(new Error("2d context unavailable"));
      ctx.drawImage(image, 0, 0, RASTER_SIZE, RASTER_SIZE);
      const texture = new Texture({ source: new ImageSource({ resource: canvas }) });
      textures.set(name, texture);
      resolve(texture);
    };
    image.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      reject(new Error(`svg decode failed: ${name}`));
    };
    image.src = blobUrl;
  });
  loading.set(name, promise);
  return promise;
}
