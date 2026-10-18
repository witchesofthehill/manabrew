import { CanvasSource, Texture, type Rectangle } from "pixi.js";
import { getCardArtWindows, type CardArtWindow } from "@/lib/cardRenderGeometry";

const artworkByTexture = new WeakMap<Texture, readonly CardArtWindow[]>();
const NO_ART_WINDOWS: readonly CardArtWindow[] = [];

export function createGeneratedCardTexture(canvas: HTMLCanvasElement, frame?: Rectangle): Texture {
  const texture = new Texture({
    frame,
    source: new CanvasSource({
      resource: canvas,
      width: canvas.width,
      height: canvas.height,
      resolution: 1,
      autoDensity: false,
      autoGenerateMipmaps: false,
    }),
  });
  artworkByTexture.set(texture, getCardArtWindows(canvas));
  return texture;
}

export function getGeneratedCardArtWindows(texture: Texture): readonly CardArtWindow[] {
  return artworkByTexture.get(texture) ?? NO_ART_WINDOWS;
}
