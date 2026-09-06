import * as THREE from "three";
import type { ArenaColors, ArenaZonePile } from "@/three/arena.types";
import { cardBackTexture } from "@/three/cardBackTexture";
import { cardGeometry } from "@/three/cardGeometry";

export function createZonePiles(scene: THREE.Scene, colors: ArenaColors) {
  const piles = new Map<
    string,
    { group: THREE.Group; pick: THREE.Mesh; label: THREE.Mesh; key: string; dispose: () => void }
  >();
  const geometry = cardGeometry();
  const edge = new THREE.MeshStandardMaterial({ color: colors.border, roughness: 0.9 });
  const backAsset = cardBackTexture(colors.background);
  const backTexture = backAsset.texture;
  const backCanvas = backTexture.image as HTMLCanvasElement;
  const back = new THREE.MeshBasicMaterial({ map: backTexture, toneMapped: false });
  const destroy = (pile: typeof piles extends Map<string, infer T> ? T : never) => {
    scene.remove(pile.group);
    pile.dispose();
    pile.label.geometry.dispose();
    (pile.label.material as THREE.MeshBasicMaterial).map?.dispose();
    (pile.label.material as THREE.Material).dispose();
  };
  return {
    picks: () =>
      [...piles.values()].flatMap((p) => (p.pick.visible ? [p.pick, p.label] : [p.label])),
    update(zones: ArenaZonePile[], hovered: string | null) {
      for (const [id, pile] of piles)
        if (!zones.some((z) => z.id === id)) {
          destroy(pile);
          piles.delete(id);
        }
      for (const zone of zones) {
        const key = JSON.stringify([zone.count, zone.topImage]);
        let pile = piles.get(zone.id);
        if (!pile) {
          const group = new THREE.Group();
          const sign = zone.side === "self" ? 1 : -1;
          group.position.set(
            sign * (zone.zone === "library" ? -9.4 : -6.9),
            0,
            zone.zone === "exile"
              ? zone.side === "self"
                ? 7.15
                : -7.55
              : zone.side === "self"
                ? 4.9
                : -9.8,
          );
          const pick = new THREE.Mesh(geometry, [back, edge]);
          pick.scale.setScalar(0.78);
          pick.userData.zoneId = zone.id;
          pick.visible = zone.zone !== "exile";
          const label = new THREE.Mesh(
            new THREE.PlaneGeometry(2.35, 0.53),
            new THREE.MeshBasicMaterial({
              transparent: true,
              depthWrite: false,
              toneMapped: false,
            }),
          );
          label.rotation.x = -Math.PI / 2;
          label.position.set(0, 0.12, zone.zone === "exile" ? 0 : 1.48);
          label.userData.zoneId = zone.id;
          group.add(pick, label);
          scene.add(group);
          pile = { group, pick, label, key: "", dispose: () => {} };
          piles.set(zone.id, pile);
        }
        const target = zone.count ? 0.16 + Math.min(zone.count, 60) * 0.006 : 0;
        pile.pick.position.y +=
          (target + (hovered === `zone:${zone.id}` ? 0.09 : 0) - pile.pick.position.y) * 0.18;
        if (pile.key === key) continue;
        pile.key = key;
        pile.dispose();
        for (const child of [...pile.group.children])
          if (child !== pile.pick && child !== pile.label) pile.group.remove(child);
        const layers = zone.zone === "exile" ? 0 : Math.min(9, Math.ceil(zone.count / 7));
        for (let i = 0; i < layers; i++) {
          const layer = new THREE.Mesh(geometry, [back, edge]);
          layer.scale.setScalar(0.78);
          layer.position.set(i * 0.009, 0.015 + (i * target) / Math.max(layers, 1), i * 0.006);
          layer.castShadow = true;
          pile.group.add(layer);
        }
        const canvas = document.createElement("canvas");
        canvas.width = 384;
        canvas.height = 536;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(backCanvas, 0, 0, 384, 536);
        if (!zone.count) {
          ctx.fillStyle = colors.surface;
          ctx.fillRect(0, 0, 384, 536);
          ctx.strokeStyle = colors.border;
          ctx.lineWidth = 8;
          ctx.strokeRect(15, 15, 354, 506);
          ctx.fillStyle = colors.muted;
          ctx.textAlign = "center";
          ctx.font = "64px Georgia";
          ctx.fillText(zone.zone === "graveyard" ? "◇" : "∅", 192, 285);
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const face = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
        pile.pick.material = [zone.zone === "library" && zone.count ? back : face, edge];
        pile.pick.castShadow = zone.count > 0;
        let disposed = false;
        if (zone.count && zone.topImage) {
          const image = new Image();
          image.crossOrigin = "anonymous";
          image.onload = () => {
            if (!disposed) {
              ctx.drawImage(image, 0, 0, 384, 536);
              texture.needsUpdate = true;
            }
          };
          image.src = zone.topImage;
        }
        pile.dispose = () => {
          disposed = true;
          texture.dispose();
          face.dispose();
        };
        const textCanvas = document.createElement("canvas");
        textCanvas.width = 520;
        textCanvas.height = 106;
        const t = textCanvas.getContext("2d")!;
        t.fillStyle = colors.background;
        t.beginPath();
        t.roundRect(3, 3, 514, 100, 20);
        t.fill();
        t.strokeStyle = colors.border;
        t.lineWidth = 3;
        t.stroke();
        t.fillStyle = colors.foreground;
        t.font = "36px Georgia";
        t.textAlign = "center";
        t.fillText(`${zone.zone.toUpperCase()}  ·  ${zone.count}`, 260, 65);
        const labelTexture = new THREE.CanvasTexture(textCanvas);
        labelTexture.colorSpace = THREE.SRGBColorSpace;
        const material = pile.label.material as THREE.MeshBasicMaterial;
        material.map?.dispose();
        material.map = labelTexture;
        material.needsUpdate = true;
      }
    },
    dispose() {
      for (const pile of piles.values()) destroy(pile);
      geometry.dispose();
      edge.dispose();
      back.dispose();
      backAsset.dispose();
    },
  };
}
