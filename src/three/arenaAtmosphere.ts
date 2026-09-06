import * as THREE from "three";
import type { ArenaColors } from "@/three/arena.types";

export function arenaAtmosphere(scene: THREE.Scene, colors: ArenaColors) {
  const positions = new Float32Array(72 * 3);
  for (let i = 0; i < 72; i++) {
    positions[i * 3] = Math.sin(i * 127.1) * 11;
    positions[i * 3 + 1] = 0.25 + (i % 9) * 0.23;
    positions[i * 3 + 2] = Math.cos(i * 311.7) * 8;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: colors.accent,
    size: 0.035,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const motes = new THREE.Points(geometry, material);
  scene.add(motes);
  const flashes: {
    mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
    start: number;
  }[] = [];
  return {
    impact(position: THREE.Vector3, time: number) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.3, 0.36, 40),
        new THREE.MeshBasicMaterial({
          color: colors.foreground,
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.copy(position);
      mesh.position.y += 0.06;
      scene.add(mesh);
      flashes.push({ mesh, start: time });
    },
    update(time: number, reduced: boolean) {
      motes.visible = !reduced;
      motes.rotation.y = reduced ? 0 : Math.sin(time * 0.000025) * 0.04;
      material.opacity = 0.27 + Math.sin(time * 0.0005) * 0.08;
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i],
          t = (time - f.start) / 360;
        if (t >= 1 || reduced) {
          scene.remove(f.mesh);
          f.mesh.geometry.dispose();
          f.mesh.material.dispose();
          flashes.splice(i, 1);
          continue;
        }
        f.mesh.scale.setScalar(1 + t * 3.5);
        f.mesh.material.opacity = (1 - t) * (1 - t) * 0.7;
      }
    },
    dispose() {
      scene.remove(motes);
      geometry.dispose();
      material.dispose();
      for (const f of flashes) {
        scene.remove(f.mesh);
        f.mesh.geometry.dispose();
        f.mesh.material.dispose();
      }
    },
  };
}
