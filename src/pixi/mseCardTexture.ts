import { CanvasSource, Texture, type Rectangle } from "pixi.js";

export function createMseCardTexture(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  frame?: Rectangle,
): Texture {
  return new Texture({
    frame,
    source: new CanvasSource({
      resource: canvas,
      width: canvas.width,
      height: canvas.height,
      resolution: 1,
      autoDensity: false,
      autoGenerateMipmaps: true,
    }),
  });
}
