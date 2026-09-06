import { CanvasTexture, SRGBColorSpace } from "three";
import type { ArenaCard, ArenaColors } from "@/three/arena.types";
import { drawFrame } from "@/three/frameAsset";

const imageCache = new Map<string, HTMLImageElement>();

export function battlefieldTexture(card: ArenaCard, colors: ArenaColors) {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 660;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(2, 2);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  let disposed = false;
  const url = card.artImage ?? card.image;
  let art: HTMLImageElement | null = url ? (imageCache.get(url) ?? null) : null;
  const draw = () => {
    ctx.clearRect(0, 0, 384, 330);
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, 384, 330);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(9, 9, 366, 312, 13);
    ctx.clip();
    if (art) {
      const crop = card.artImage
        ? { x: 0, y: 0, w: art.width, h: art.height }
        : { x: art.width * 0.09, y: art.height * 0.12, w: art.width * 0.82, h: art.height * 0.39 };
      const ratio = 366 / 272;
      if (crop.w / crop.h > ratio) {
        const w = crop.h * ratio;
        crop.x += (crop.w - w) / 2;
        crop.w = w;
      } else {
        const h = crop.w / ratio;
        crop.y += (crop.h - h) / 2;
        crop.h = h;
      }
      ctx.drawImage(art, crop.x, crop.y, crop.w, crop.h, 9, 40, 366, 272);
    } else {
      const gradient = ctx.createLinearGradient(0, 40, 300, 312);
      gradient.addColorStop(0, card.color);
      gradient.addColorStop(1, colors.surface);
      ctx.fillStyle = gradient;
      ctx.fillRect(9, 40, 366, 272);
    }
    const lower = ctx.createLinearGradient(0, 225, 0, 321);
    lower.addColorStop(0, "transparent");
    lower.addColorStop(1, colors.background);
    ctx.fillStyle = lower;
    ctx.fillRect(9, 225, 366, 96);
    ctx.fillStyle = card.color;
    ctx.fillRect(9, 9, 366, 33);
    ctx.fillRect(9, 309, 366, 12);
    ctx.fillStyle = colors.background;
    ctx.font = "bold 22px Georgia";
    ctx.fillText(card.name, 18, 33, 348);
    ctx.restore();
    ctx.strokeStyle = card.color;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.roundRect(9, 9, 366, 312, 13);
    ctx.stroke();
    drawFrame(ctx, card, colors);
    if (card.stats) {
      ctx.fillStyle = colors.foreground;
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(224, 276, 125, 46, 16);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = card.statsChanged ? colors.hostile : colors.background;
      ctx.font = "bold 36px Georgia";
      ctx.textAlign = "center";
      ctx.fillText(card.stats, 286, 311, 111);
      ctx.textAlign = "start";
    }
    if (card.tapped) {
      ctx.save();
      ctx.globalAlpha = 0.68;
      ctx.fillStyle = colors.background;
      ctx.beginPath();
      ctx.arc(188, 169, 63, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.92;
      ctx.strokeStyle = colors.foreground;
      ctx.lineWidth = 14;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(188, 169, 36, Math.PI * 0.2, Math.PI * 1.75);
      ctx.stroke();
      ctx.fillStyle = colors.foreground;
      ctx.beginPath();
      ctx.moveTo(203, 115);
      ctx.lineTo(230, 151);
      ctx.lineTo(188, 153);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    if (card.selected || card.attacking) {
      ctx.strokeStyle = card.attacking ? colors.hostile : colors.accent;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = card.selected ? 16 : 8;
      ctx.lineWidth = card.selected ? 6 : 3;
      ctx.beginPath();
      ctx.roundRect(3, 3, 378, 324, 17);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    texture.needsUpdate = true;
  };
  draw();
  if (url && !art) {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (imageCache.size >= 128) imageCache.delete(imageCache.keys().next().value!);
      imageCache.set(url, image);
      if (!disposed) {
        art = image;
        draw();
      }
    };
    image.src = url;
  }
  return {
    texture,
    dispose: () => {
      disposed = true;
      texture.dispose();
    },
  };
}
