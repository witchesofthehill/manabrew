import { CanvasSource, ImageSource, Texture } from "pixi.js";
import type { Rectangle } from "pixi.js";
import { retainCardRaster } from "@/lib/cardRenderTypes";
import type { CardRaster } from "@/lib/cardRenderTypes";
import { getCardArtWindows, type CardArtWindow } from "@/lib/cardRenderGeometry";

const artworkByTexture = new WeakMap<Texture, readonly CardArtWindow[]>();
const NO_ART_WINDOWS: readonly CardArtWindow[] = [];

export function createGeneratedCardTexture(raster: CardRaster, frame?: Rectangle): Texture {
  const release = retainCardRaster(raster);
  try {
    const options = {
      resource: raster,
      width: raster.width,
      height: raster.height,
      resolution: 1,
      autoGenerateMipmaps: true,
      addressMode: "clamp-to-edge" as const,
      scaleMode: "linear" as const,
      mipmapFilter: "linear" as const,
    };
    const source =
      "getContext" in raster
        ? new CanvasSource({ ...options, resource: raster, autoDensity: false })
        : new ImageSource({ ...options, resource: raster });
    source.once("destroy", release);
    const texture = new Texture({ frame, source });
    artworkByTexture.set(texture, getCardArtWindows(raster));
    return texture;
  } catch (error) {
    release();
    throw error;
  }
}

export function getGeneratedCardArtWindows(texture: Texture): readonly CardArtWindow[] {
  return artworkByTexture.get(texture) ?? NO_ART_WINDOWS;
}
