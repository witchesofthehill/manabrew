import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import tableUrl from "@/three/assets/arena-table.glb?url";
import type { ArenaColors } from "@/three/arena.types";
import { woodTexture } from "@/three/woodTexture";

export function arenaTable(scene: THREE.Scene, colors: ArenaColors) {
  let disposed = false;
  let model: THREE.Group | undefined;
  const wood = woodTexture(colors);
  const candleLights = [
    [-11, 1.1, 0],
    [-10.8, 0.85, -0.7],
    [11, 1.3, -2.4],
  ].map((position) => {
    const light = new THREE.PointLight(colors.accent, 6, 6, 2);
    light.position.set(...(position as [number, number, number]));
    scene.add(light);
    return light;
  });
  const grain = new Uint8Array(128 * 128);
  let seed = 43;
  for (let i = 0; i < grain.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    grain[i] = 100 + (seed % 55);
  }
  const bump = new THREE.DataTexture(grain, 128, 128, THREE.RedFormat);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.magFilter = bump.minFilter = THREE.LinearFilter;
  bump.repeat.set(3, 3);
  bump.needsUpdate = true;
  const release = (group: THREE.Group) => {
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        material.dispose();
    });
  };
  new GLTFLoader().load(tableUrl, (gltf) => {
    if (disposed) {
      release(gltf.scene);
      return;
    }
    model = gltf.scene;
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.receiveShadow = true;
      object.castShadow = false;
      const material = object.material as THREE.MeshStandardMaterial;
      const wooden = material.name.startsWith("wood-");
      object.castShadow = !wooden && material.name !== "flame";
      if (wooden) {
        material.map = wood;
        material.bumpMap = bump;
        material.bumpScale = 0.015;
        material.color
          .set(colors.foreground)
          .multiplyScalar(0.6 + Number(material.name.slice(-1)) * 0.025);
      } else {
        material.color.set(
          material.name === "wax"
            ? colors.foreground
            : material.name === "brass"
              ? colors.accent
              : colors.background,
        );
      }
      if (material.name === "flame") {
        material.color.set(colors.foreground);
        material.emissive.set(colors.accent);
        material.emissiveIntensity = 3;
      }
    });
    scene.add(model);
  });
  return {
    update(time: number, reduced: boolean) {
      candleLights.forEach((light, i) => {
        light.intensity =
          6 +
          (reduced
            ? 0
            : Math.sin(time * 0.0027 + i) * 0.3 + Math.sin(time * 0.0071 + i * 2) * 0.12);
      });
    },
    dispose() {
      disposed = true;
      bump.dispose();
      wood.dispose();
      candleLights.forEach((light) => {
        scene.remove(light);
        light.dispose();
      });
      if (model) {
        scene.remove(model);
        release(model);
      }
    },
  };
}
