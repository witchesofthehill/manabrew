import {
  Mesh,
  MeshBasicMaterial,
  Shape,
  Path,
  ShapeGeometry,
  DoubleSide,
  Color,
  AdditiveBlending,
} from "three";
import {
  CARD_WIDTH,
  CARD_HEIGHT,
  BATTLEFIELD_CARD_HEIGHT,
  CARD_RADIUS,
} from "@/three/cardGeometry";

export function cardGlow(compact: boolean, color: string) {
  const height = compact ? BATTLEFIELD_CARD_HEIGHT : CARD_HEIGHT;
  const rounded = (path: Shape | Path, x: number, y: number, r: number) => {
    path.moveTo(-x + r, -y);
    path.absarc(x - r, -y + r, r, -Math.PI / 2, 0, false);
    path.absarc(x - r, y - r, r, 0, Math.PI / 2, false);
    path.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI, false);
    path.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5, false);
    path.closePath();
  };
  const tint = new Color(color);
  const hsl = tint.getHSL({ h: 0, s: 0, l: 0 });
  tint.setHSL(hsl.h, Math.min(1, hsl.s * 2), hsl.l);
  const band = (outer: number, inner: number, strength: number) => {
    const shape = new Shape();
    rounded(shape, CARD_WIDTH / 2 + outer, height / 2 + outer, CARD_RADIUS + outer);
    const hole = new Path();
    rounded(hole, CARD_WIDTH / 2 + inner, height / 2 + inner, CARD_RADIUS + inner);
    shape.holes.push(hole);
    const geometry = new ShapeGeometry(shape, 12);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new Mesh(
      geometry,
      new MeshBasicMaterial({
        color: tint,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
        blending: AdditiveBlending,
      }),
    );
    mesh.userData.strength = strength;
    return mesh;
  };
  const mesh = band(0.035, 0.003, 1);
  mesh.position.y = 0.025;
  mesh.add(band(0.065, 0.035, 0.35), band(0.105, 0.065, 0.15), band(0.155, 0.105, 0.06));
  return mesh;
}

export function disposeCardGlow(glow: ReturnType<typeof cardGlow>) {
  glow.traverse((object) => {
    if (object instanceof Mesh) {
      object.geometry.dispose();
      (object.material as MeshBasicMaterial).dispose();
    }
  });
}
