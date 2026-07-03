import { ImageSource, Texture } from "pixi.js";

const MAX_RASTER = 256;
const textures = new Map<string, Texture>();
const loading = new Map<string, Promise<Texture>>();

/** Load a player avatar (data URL, blob URL, or CORS-enabled http URL) into a
 *  Pixi texture by drawing it onto a canvas — the same path the mana/icon
 *  caches use. `Assets.load` can't infer a loader for extension-less data URLs
 *  (exactly how uploaded avatars are stored: `normalizeToWebp` → data URL), and
 *  setting `crossOrigin` on a data URL breaks the load in some webviews, so we
 *  only set it for real cross-origin http URLs. */
export function loadAvatarTexture(url: string): Promise<Texture> {
  const cached = textures.get(url);
  if (cached && !cached.destroyed) return Promise.resolve(cached);
  const inflight = loading.get(url);
  if (inflight) return inflight;

  const promise = new Promise<Texture>((resolve, reject) => {
    const img = new Image();
    if (/^https?:/i.test(url)) img.crossOrigin = "anonymous";
    img.onload = () => {
      const iw = img.naturalWidth || MAX_RASTER;
      const ih = img.naturalHeight || MAX_RASTER;
      const scale = Math.min(1, MAX_RASTER / Math.max(iw, ih));
      const w = Math.max(1, Math.round(iw * scale));
      const h = Math.max(1, Math.round(ih * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("2d context unavailable"));
      ctx.drawImage(img, 0, 0, w, h);
      const tex = new Texture({ source: new ImageSource({ resource: canvas }) });
      textures.set(url, tex);
      resolve(tex);
    };
    img.onerror = () => reject(new Error(`avatar load failed: ${url}`));
    img.src = url;
  }).finally(() => loading.delete(url));

  loading.set(url, promise);
  return promise;
}
