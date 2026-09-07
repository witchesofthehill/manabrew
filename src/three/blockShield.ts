import * as THREE from "three";
import type { ArenaColors } from "@/three/arena.types";

export function blockShield(colors: ArenaColors) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.29, 0.28);
  shape.lineTo(0, 0.38);
  shape.lineTo(0.29, 0.28);
  shape.lineTo(0.25, -0.1);
  shape.quadraticCurveTo(0.17, -0.28, 0, -0.4);
  shape.quadraticCurveTo(-0.17, -0.28, -0.25, -0.1);
  shape.closePath();
  return [
    { color: colors.block ?? colors.playable ?? colors.accent, scale: 1.22, opacity: 0.16, z: 0 },
    { color: colors.block ?? colors.playable ?? colors.accent, scale: 1, opacity: 1, z: 0.01 },
    { color: colors.background, scale: 0.78, opacity: 1, z: 0.02 },
    { color: colors.block ?? colors.playable ?? colors.accent, scale: 0.42, opacity: 1, z: 0.03 },
  ].map(({ color, scale, opacity, z }) => {
    const mesh = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({
        color,
        opacity,
        transparent: opacity < 1,
        depthTest: false,
        depthWrite: false,
      }),
    );
    mesh.scale.setScalar(scale);
    mesh.userData.shieldOffset = z;
    mesh.renderOrder = 5 + z * 100;
    return mesh;
  });
}
