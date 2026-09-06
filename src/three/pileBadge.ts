import * as THREE from "three";
import type { ArenaColors } from "@/three/arena.types";
export function clearPileBadge(mesh: THREE.Mesh) {
  const badge = mesh.userData.pileBadge as THREE.Sprite | undefined;
  if (badge) {
    mesh.remove(badge);
    badge.material.map?.dispose();
    badge.material.dispose();
    delete mesh.userData.pileBadge;
  }
}
export function updatePileBadge(mesh: THREE.Mesh, count: number | undefined, colors: ArenaColors) {
  if (mesh.userData.pileCount === count) return;
  clearPileBadge(mesh);
  mesh.userData.pileCount = count;
  if (!count) return;
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 80;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = colors.background;
  ctx.strokeStyle = colors.foreground;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(3, 3, 154, 74, 16);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = colors.foreground;
  ctx.font = "bold 50px Georgia";
  ctx.textAlign = "center";
  ctx.fillText(`x${count}`, 80, 57);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const badge = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthWrite: false, toneMapped: false }),
  );
  badge.scale.set(0.66, 0.33, 1);
  badge.position.set(-0.83, 0.2, -0.67);
  mesh.add(badge);
  mesh.userData.pileBadge = badge;
}
