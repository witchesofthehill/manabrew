import * as THREE from "three";
import type { ArenaColors } from "@/three/arena.types";

export function arenaAtmosphere(scene: THREE.Scene, colors: ArenaColors) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, colors.foreground);
  gradient.addColorStop(0.2, colors.foreground);
  gradient.addColorStop(1, "transparent");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const sparkTexture = new THREE.CanvasTexture(canvas);
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
    map: sparkTexture,
  });
  const motes = new THREE.Points(geometry, material);
  scene.add(motes);
  const flashes: {
    mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
    dust: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
    glow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    start: number;
  }[] = [];
  const removeFlash = (f: (typeof flashes)[number]) => {
    for (const object of [f.mesh, f.dust, f.glow]) {
      scene.remove(object);
      object.geometry.dispose();
      object.material.dispose();
    }
  };
  return {
    impact(position: THREE.Vector3, time: number) {
      if (flashes.length >= 12) removeFlash(flashes.shift()!);
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.3, 0.36, 40),
        new THREE.MeshBasicMaterial({
          color: colors.foreground,
          transparent: true,
          opacity: 0.3,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.copy(position);
      mesh.position.y += 0.06;
      scene.add(mesh);
      const dustGeometry = new THREE.BufferGeometry();
      dustGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
      const dust = new THREE.Points(
        dustGeometry,
        new THREE.PointsMaterial({
          map: sparkTexture,
          color: colors.accent,
          size: 0.09,
          transparent: true,
          opacity: 0.6,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      dust.position.copy(position);
      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(3.4, 3.4),
        new THREE.MeshBasicMaterial({
          map: sparkTexture,
          color: colors.accent,
          transparent: true,
          opacity: 0.2,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.copy(position);
      glow.position.y += 0.025;
      scene.add(dust, glow);
      flashes.push({ mesh, dust, glow, start: time });
    },
    update(time: number, reduced: boolean) {
      motes.visible = !reduced;
      motes.rotation.y = reduced ? 0 : Math.sin(time * 0.000025) * 0.04;
      material.opacity = 0.27 + Math.sin(time * 0.0005) * 0.08;
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i],
          t = (time - f.start) / 650;
        if (t >= 1 || reduced) {
          removeFlash(f);
          flashes.splice(i, 1);
          continue;
        }
        f.mesh.scale.setScalar(1 + t * 2.5);
        f.mesh.material.opacity = (1 - t) ** 3 * 0.3;
        f.glow.material.opacity = (1 - t) ** 3 * 0.2;
        f.dust.material.opacity = (1 - t) ** 2 * 0.6;
        const points = f.dust.geometry.getAttribute("position");
        for (let j = 0; j < 24; j++) {
          const angle = j * 2.39996;
          const radius = 0.5 + t * (0.7 + (j % 5) * 0.14);
          points.setXYZ(
            j,
            Math.cos(angle) * radius,
            Math.sin(t * Math.PI) * (0.12 + (j % 4) * 0.09),
            Math.sin(angle) * radius,
          );
        }
        points.needsUpdate = true;
      }
    },
    dispose() {
      scene.remove(motes);
      geometry.dispose();
      material.dispose();
      sparkTexture.dispose();
      for (const f of flashes) {
        removeFlash(f);
      }
    },
  };
}
