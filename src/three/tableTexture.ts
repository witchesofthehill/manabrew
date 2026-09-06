import { CanvasTexture, SRGBColorSpace } from "three";
import type { ArenaColors } from "@/three/arena.types";

export function tableTexture(colors: ArenaColors) {
  const canvas = document.createElement("canvas");
  canvas.width = 1536;
  canvas.height = 1400;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = colors.surface;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < 1400; y += 64)
    for (let x = 0; x < 1536; x += 96) {
      ctx.globalAlpha = 0.045 + ((x * 13 + y * 7) % 19) / 700;
      ctx.fillStyle = colors.background;
      ctx.fillRect(x + (y % 128 ? 48 : 0), y, 94, 62);
    }
  // Fine, deterministic mineral grain and a broad pool of light keep card art dominant.
  let seed = 7419;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 24000; i++) {
    const x = random() * 1536,
      y = random() * 1400;
    ctx.globalAlpha = 0.025 + (i % 5) * 0.009;
    ctx.fillStyle = i % 3 ? colors.foreground : colors.background;
    ctx.fillRect(x, y, 1 + (i % 3), 1);
  }
  const light = ctx.createRadialGradient(768, 618, 80, 768, 700, 870);
  light.addColorStop(0, "transparent");
  light.addColorStop(0.65, "transparent");
  light.addColorStop(1, colors.background);
  ctx.globalAlpha = 1;
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, 1536, 1400);
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = colors.background;
  for (const radius of [200, 214, 260, 267, 420]) {
    ctx.lineWidth = radius === 214 ? 5 : 2;
    ctx.beginPath();
    ctx.arc(768, 700, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.save();
  ctx.translate(768, 700);
  for (let i = 0; i < 40; i++) {
    ctx.rotate(Math.PI / 20);
    ctx.beginPath();
    ctx.moveTo(0, 270);
    ctx.lineTo(0, i % 5 ? 280 : 295);
    ctx.stroke();
  }
  for (let i = 0; i < 8; i++) {
    ctx.rotate(Math.PI / 4);
    ctx.beginPath();
    ctx.moveTo(0, -180);
    ctx.lineTo(110, 90);
    ctx.lineTo(-110, 90);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 0.4;
  ctx.strokeRect(35, 35, 1466, 1330);
  ctx.strokeRect(48, 48, 1440, 1304);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
