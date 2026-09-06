import { CanvasTexture, SRGBColorSpace } from "three";
import backUrl from "@/three/assets/card-back.png";

let backImage: HTMLImageElement | undefined;
const waiting = new Set<() => void>();

export function cardBackTexture(background: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 672;
  canvas.height = 939;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const draw = () => {
    if (backImage?.naturalWidth) {
      ctx.drawImage(backImage, 0, 0, canvas.width, canvas.height);
      texture.needsUpdate = true;
    }
  };
  if (!backImage) {
    backImage = new Image();
    backImage.onload = () => {
      for (const paint of waiting) paint();
      waiting.clear();
    };
    backImage.src = backUrl;
  }
  if (backImage.complete && backImage.naturalWidth) draw();
  else waiting.add(draw);
  return {
    texture,
    dispose: () => {
      waiting.delete(draw);
      texture.dispose();
    },
  };
}
