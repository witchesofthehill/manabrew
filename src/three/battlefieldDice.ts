import * as THREE from "three";
import type { ArenaColors, ArenaSceneProps } from "@/three/arena.types";

export function battlefieldDice(scene: THREE.Scene, colors: ArenaColors) {
  const group = new THREE.Group();
  scene.add(group);
  let key: string | undefined;
  let started = 0;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const dice: { mesh: THREE.Group; rotation: THREE.Quaternion; x: number; z: number; y: number }[] =
    [];
  const resources: { dispose: () => void }[] = [];
  const clear = () => {
    group.clear();
    resources.splice(0).forEach((r) => r.dispose());
    dice.length = 0;
  };
  return {
    update(roll: ArenaSceneProps["diceRoll"], time: number) {
      if (roll?.id !== key) {
        clear();
        key = roll?.id;
        started = time;
        if (roll) {
          const values = roll.input.rolls.flatMap((entry) => entry.naturalResults);
          values.forEach((value, index) => {
            const sides = roll.input.sides;
            const geometry =
              sides === 6
                ? new THREE.BoxGeometry(1.2, 1.2, 1.2)
                : sides === 4
                  ? new THREE.TetrahedronGeometry(0.95)
                  : sides === 8
                    ? new THREE.OctahedronGeometry(0.95)
                    : sides === 12
                      ? new THREE.DodecahedronGeometry(0.95)
                      : sides === 20
                        ? new THREE.IcosahedronGeometry(0.95)
                        : new THREE.BoxGeometry(1.2, 1.2, 1.2);
            const flat = geometry.index ? geometry.toNonIndexed() : geometry;
            if (flat !== geometry) geometry.dispose();
            const material = new THREE.MeshStandardMaterial({
              color: colors.surface,
              roughness: 0.32,
              metalness: 0.45,
              flatShading: true,
            });
            const body = new THREE.Mesh(flat, material);
            body.castShadow = true;
            body.receiveShadow = true;
            const die = new THREE.Group();
            die.add(body);
            const edges = new THREE.EdgesGeometry(flat);
            const edgeMaterial = new THREE.LineBasicMaterial({
              color: colors.accent,
              transparent: true,
              opacity: 0.65,
            });
            die.add(new THREE.LineSegments(edges, edgeMaterial));
            resources.push(flat, material, edges, edgeMaterial);
            const positions = flat.getAttribute("position");
            const faces = new Map<
              string,
              { normal: THREE.Vector3; center: THREE.Vector3; count: number }
            >();
            for (let i = 0; i < positions.count; i += 3) {
              const a = new THREE.Vector3().fromBufferAttribute(positions, i);
              const b = new THREE.Vector3().fromBufferAttribute(positions, i + 1);
              const c = new THREE.Vector3().fromBufferAttribute(positions, i + 2);
              const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
              const faceKey = normal
                .toArray()
                .map((n) => String(Math.round(n * 1000)))
                .join(",");
              const center = a.add(b).add(c).divideScalar(3);
              const face = faces.get(faceKey);
              if (face) {
                face.center.add(center);
                face.count++;
              } else faces.set(faceKey, { normal, center, count: 1 });
            }
            let top = new THREE.Vector3(0, 1, 0);
            let topUp = new THREE.Vector3(0, 0, -1);
            [...faces.values()].forEach((face, faceIndex) => {
              const number = [4, 6, 8, 12, 20].includes(sides) ? (faceIndex % sides) + 1 : value;
              if (number === value) top = face.normal;
              const canvas = document.createElement("canvas");
              canvas.width = canvas.height = 128;
              const ctx = canvas.getContext("2d")!;
              ctx.fillStyle = colors.foreground;
              ctx.font = "bold 80px Georgia";
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(String(number), 64, 68);
              if (number === 6 || number === 9) ctx.fillRect(43, 107, 42, 4);
              const texture = new THREE.CanvasTexture(canvas);
              texture.colorSpace = THREE.SRGBColorSpace;
              const labelGeometry = new THREE.PlaneGeometry(
                sides === 6 ? 0.7 : 0.45,
                sides === 6 ? 0.7 : 0.45,
              );
              const labelMaterial = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                depthWrite: false,
              });
              const label = new THREE.Mesh(labelGeometry, labelMaterial);
              label.position
                .copy(face.center.divideScalar(face.count))
                .addScaledVector(face.normal, 0.006);
              label.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), face.normal);
              if (number === value)
                topUp = new THREE.Vector3(0, 1, 0).applyQuaternion(label.quaternion);
              die.add(label);
              resources.push(texture, labelGeometry, labelMaterial);
            });
            const columns = Math.min(5, values.length);
            const x = ((index % columns) - (columns - 1) / 2) * 2.2;
            const z =
              (Math.floor(index / columns) - Math.floor((values.length - 1) / columns) / 2) * 2.2;
            const rotation = new THREE.Quaternion().setFromUnitVectors(
              top,
              new THREE.Vector3(0, 1, 0),
            );
            topUp.applyQuaternion(rotation);
            rotation.premultiply(
              new THREE.Quaternion().setFromAxisAngle(
                new THREE.Vector3(0, 1, 0),
                Math.atan2(topUp.x, -topUp.z),
              ),
            );
            let floor = 0;
            for (let v = 0; v < positions.count; v++)
              floor = Math.min(
                floor,
                new THREE.Vector3().fromBufferAttribute(positions, v).applyQuaternion(rotation).y,
              );
            group.add(die);
            dice.push({
              mesh: die,
              rotation,
              y: -0.17 - floor,
              x,
              z,
            });
          });
        }
      }
      dice.forEach((die, i) => {
        const t = reduced.matches
          ? 1
          : THREE.MathUtils.clamp((time - started - Math.min(i, 4) * 70) / 1400, 0, 1);
        const remaining = 1 - t;
        die.mesh.position.set(
          die.x - remaining * remaining * 5,
          die.y + Math.abs(Math.sin(t * Math.PI * 3)) * remaining * 2.8,
          die.z - remaining * 2,
        );
        die.mesh.quaternion
          .copy(die.rotation)
          .multiply(
            new THREE.Quaternion().setFromEuler(
              new THREE.Euler(
                remaining * Math.PI * 5,
                remaining * Math.PI * 3,
                remaining * Math.PI * 2,
              ),
            ),
          );
        die.mesh.scale.setScalar(Math.min(1, t * 8 + 0.1));
      });
    },
    dispose() {
      clear();
      scene.remove(group);
    },
  };
}
