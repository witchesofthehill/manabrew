import * as THREE from "three";
import { loadManaSprite } from "@/three/battlefieldMana";
import { manaCells } from "@/three/manaCells";
import { CARD_HEIGHT, CARD_WIDTH, CARD_THICKNESS } from "@/three/cardGeometry";
import type { ArenaColors } from "@/three/arena.types";
import { manaCostSymbols } from "@/three/manaCostSymbols";

export function handManaCost(cost: string, colors: ArenaColors) {
  const symbols = manaCostSymbols(cost);
  if (!symbols.length) return;
  const canvas = document.createElement("canvas");
  canvas.width = symbols.length * 112 + 16;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  });
  const width = Math.min(CARD_WIDTH - 0.24, symbols.length * 0.27);
  const height = (width * canvas.height) / canvas.width;
  const geometry = new THREE.PlaneGeometry(width, height);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(
    CARD_WIDTH / 2 - 0.12 - width / 2,
    CARD_THICKNESS / 2 + 0.002,
    -CARD_HEIGHT / 2 - height / 2 + 0.018,
  );
  mesh.renderOrder = 12;
  let disposed = false;
  const draw = (image: HTMLImageElement | null) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    symbols.forEach((symbol, i) => {
      const x = 8 + i * 112;
      ctx.shadowColor = colors.background;
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 4;
      const cell = manaCells[symbol];
      if (image && cell)
        ctx.drawImage(image, cell[0] * 105, cell[1] * 105, 100, 100, x, 10, 100, 100);
      else {
        ctx.fillStyle = colors.foreground;
        ctx.beginPath();
        ctx.arc(x + 50, 60, 48, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        ctx.fillStyle = colors.background;
        ctx.font = "bold 58px Georgia";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(symbol, x + 50, 62, 85);
      }
    });
    texture.needsUpdate = true;
  };
  draw(null);
  void loadManaSprite().then((image) => {
    if (!disposed) draw(image);
  });
  return {
    mesh,
    dispose() {
      disposed = true;
      texture.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
