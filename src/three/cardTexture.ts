import { loadArenaImage } from "@/three/arenaImageCache";
import { CanvasTexture, SRGBColorSpace } from "three";
import type { ArenaCard, ArenaColors } from "@/three/arena.types";
import { CARD_TEXTURE_WIDTH, CARD_TEXTURE_HEIGHT } from "@/three/cardGeometry";
import { battlefieldTexture } from "@/three/battlefieldTexture";
import { cardBackTexture } from "@/three/cardBackTexture";

export function cardTexture(card: ArenaCard, colors: ArenaColors) {
  if (card.hidden) return cardBackTexture(colors.background);
  if (card.side !== "hand" && !card.hidden) return battlefieldTexture(card, colors);
  const canvas = document.createElement("canvas");
  canvas.width = CARD_TEXTURE_WIDTH;
  canvas.height = CARD_TEXTURE_HEIGHT;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(canvas.width / 384, canvas.height / 536);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  let disposed = false;
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, 384, 536);
  ctx.strokeStyle = card.color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(9, 9, 366, 518, 13);
  ctx.stroke();
  const gradient = ctx.createLinearGradient(0, 70, 340, 370);
  gradient.addColorStop(0, card.color);
  gradient.addColorStop(1, colors.background);
  ctx.fillStyle = gradient;
  ctx.fillRect(21, 65, 342, 276);
  let seed = [...card.name].reduce((n, c) => n + c.charCodeAt(0), 0);
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = i % 2 ? colors.surface : colors.background;
    ctx.globalAlpha = 0.2 + random() * 0.45;
    ctx.beginPath();
    const x = random() * 400;
    ctx.moveTo(x - 120, 341);
    ctx.lineTo(x, 100 + random() * 150);
    ctx.lineTo(x + 130, 341);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = card.color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(192, 190, 55, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = colors.foreground;
  ctx.font = "bold 23px Georgia";
  ctx.fillText(card.hidden ? "MANABREW" : card.name, 23, 43, 335);
  ctx.font = "17px Georgia";
  ctx.fillText(card.hidden ? "Hidden card" : card.type, 23, 372, 334);
  ctx.font = "16px sans-serif";
  const words = (card.hidden ? "" : card.text).split(/\s+/);
  let line = "";
  let y = 409;
  for (const word of words) {
    if (ctx.measureText(`${line} ${word}`).width > 326) {
      ctx.fillText(line, 25, y);
      line = word;
      y += 22;
      if (y > 460) break;
    } else line += `${line ? " " : ""}${word}`;
  }
  if (y <= 460) ctx.fillText(line, 25, y);
  ctx.font = "bold 23px Georgia";
  ctx.fillText(card.hidden ? "" : (card.stats ?? card.cost), 240, 505, 110);
  if (card.image && !card.hidden) {
    void loadArenaImage(card.image).then((image) => {
      if (disposed || !image) return;
      ctx.drawImage(image, 0, 0, 384, 536);
      if (card.stats && card.statsChanged && card.side !== "hand") {
        ctx.fillStyle = colors.background;
        ctx.beginPath();
        ctx.roundRect(255, 475, 105, 43, 12);
        ctx.fill();
        ctx.strokeStyle = card.color;
        ctx.stroke();
        ctx.fillStyle = colors.foreground;
        ctx.font = "bold 28px Georgia";
        ctx.fillText(card.stats, 267, 506, 85);
      }
      texture.needsUpdate = true;
    });
  }
  return {
    texture,
    dispose: () => {
      disposed = true;
      texture.dispose();
    },
  };
}
