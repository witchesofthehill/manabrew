import { ExtrudeGeometry, Shape } from "three";

export const CARD_WIDTH = 2.15;
export const CARD_HEIGHT = CARD_WIDTH * (88 / 63);
export const CARD_RADIUS = CARD_WIDTH * (3 / 63);
export const CARD_THICKNESS = CARD_WIDTH * (0.32 / 63);
export const CARD_TEXTURE_WIDTH = 672;
export const CARD_TEXTURE_HEIGHT = 939;
export const BATTLEFIELD_CARD_HEIGHT = CARD_WIDTH * (330 / 384);

export function cardGeometry(compact = false) {
  const height = compact ? BATTLEFIELD_CARD_HEIGHT : CARD_HEIGHT;
  const bevel = 0.002;
  const x = CARD_WIDTH / 2 - bevel;
  const y = height / 2 - bevel;
  const r = CARD_RADIUS - bevel;
  const shape = new Shape();
  shape.moveTo(-x + r, -y);
  shape.lineTo(x - r, -y);
  shape.absarc(x - r, -y + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(x, y - r);
  shape.absarc(x - r, y - r, r, 0, Math.PI / 2, false);
  shape.lineTo(-x + r, y);
  shape.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(-x, -y + r);
  shape.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5, false);
  const geometry = new ExtrudeGeometry(shape, {
    depth: CARD_THICKNESS - bevel * 2,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 12,
  });
  geometry.translate(0, 0, -(CARD_THICKNESS - bevel * 2) / 2);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < position.count; i++) {
    uv.setXY(i, position.getX(i) / CARD_WIDTH + 0.5, 0.5 - position.getZ(i) / height);
  }
  uv.needsUpdate = true;
  return geometry;
}
