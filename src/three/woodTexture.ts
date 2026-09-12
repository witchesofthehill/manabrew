import * as THREE from "three";
import type { ArenaColors } from "@/three/arena.types";

export function woodTexture(colors: ArenaColors) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = new THREE.Color(colors.accent)
    .lerp(new THREE.Color(colors.background), 0.8)
    .getStyle();
  ctx.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 580; i++) {
    const y = (i * 137.3) % 512;
    ctx.strokeStyle = i % 5 ? colors.background : colors.accent;
    ctx.globalAlpha = 0.04 + (i % 7) * 0.018;
    ctx.lineWidth = i % 9 ? 0.7 : 2;
    ctx.beginPath();
    for (let x = 0; x <= 1024; x += 8) {
      const bend = Math.sin(x * 0.007 + i * 0.02) * 3 + Math.sin(x * 0.021 + i) * 0.7;
      ctx.lineTo(x, y + bend);
    }
    ctx.stroke();
  }
  for (const [x, y] of [
    [260, 160],
    [790, 370],
  ]) {
    for (let ring = 1; ring < 13; ring++) {
      ctx.globalAlpha = 0.13 - ring * 0.007;
      ctx.strokeStyle = colors.background;
      ctx.beginPath();
      ctx.ellipse(x, y, ring * 5, ring * 1.2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  for (let i = 0; i < 45; i++) {
    ctx.globalAlpha = 0.045;
    ctx.strokeStyle = i % 2 ? colors.foreground : colors.background;
    const x = (i * 193.7) % 1024,
      y = (i * 67.1) % 512;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 8 + (i % 8) * 4, y + Math.sin(i) * 2);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}
