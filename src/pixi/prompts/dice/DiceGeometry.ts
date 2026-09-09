import { Container, Graphics, GraphicsContext, Text, TextStyle } from "pixi.js";

export interface RollTokenVisual {
  root: Container;
  face: Graphics;
  shadow: Graphics;
  value: Text;
  pips: Graphics[];
  glint: Graphics;
  sides: number;
}

interface RollTokenOptions {
  sides: number;
  size: number;
  fill: string;
  border: string;
  foreground: string;
  shadow: string;
}

const contexts = new Map<string, GraphicsContext>();

function polygonForSides(sides: number, half: number): number[] | null {
  switch (sides) {
    case 4:
      return [0, -half, half, half, -half, half];
    case 8:
      return [0, -half, half, 0, 0, half, -half, 0];
    case 10:
      return [
        0,
        -half,
        half * 0.82,
        -half * 0.18,
        half * 0.48,
        half,
        -half * 0.48,
        half,
        -half * 0.82,
        -half * 0.18,
      ];
    case 12:
      return [
        -half * 0.55,
        -half,
        half * 0.55,
        -half,
        half,
        -half * 0.25,
        half * 0.8,
        half * 0.72,
        0,
        half,
        -half * 0.8,
        half * 0.72,
        -half,
        -half * 0.25,
      ];
    case 20:
      return [
        -half * 0.42,
        -half,
        half * 0.42,
        -half,
        half,
        -half * 0.42,
        half,
        half * 0.42,
        half * 0.42,
        half,
        -half * 0.42,
        half,
        -half,
        half * 0.42,
        -half,
        -half * 0.42,
      ];
    default:
      return null;
  }
}

function faceContext(options: RollTokenOptions): GraphicsContext {
  const sides = options.sides;
  const key = [sides, options.size, options.fill, options.border, options.foreground].join(":");
  const cached = contexts.get(key);
  if (cached) return cached;
  const context = new GraphicsContext();
  const half = options.size / 2;
  if (sides === 6) {
    context
      .roundRect(-half, -half, options.size, options.size, options.size * 0.16)
      .fill(options.fill)
      .stroke({ color: options.border, width: 2 });
  } else {
    const polygon = polygonForSides(sides, half);
    if (polygon) context.poly(polygon);
    else context.circle(0, 0, half);
    context.fill(options.fill).stroke({ color: options.border, width: 2 });
    context
      .moveTo(0, -half * 0.78)
      .lineTo(0, half * 0.78)
      .moveTo(-half * 0.68, 0)
      .lineTo(half * 0.68, 0)
      .stroke({ color: options.border, width: 1, alpha: 0.24 });
  }
  context
    .moveTo(-half * 0.62, -half * 0.48)
    .quadraticCurveTo(0, -half * 0.78, half * 0.58, -half * 0.38)
    .stroke({ color: options.foreground, width: 1.4, alpha: 0.2 });
  contexts.set(key, context);
  return context;
}

function pipPositions(value: number): Array<[number, number]> {
  const left = -0.23;
  const right = 0.23;
  const top = -0.23;
  const bottom = 0.23;
  const center: [number, number] = [0, 0];
  const positions: Record<number, Array<[number, number]>> = {
    1: [center],
    2: [
      [left, top],
      [right, bottom],
    ],
    3: [[left, top], center, [right, bottom]],
    4: [
      [left, top],
      [right, top],
      [left, bottom],
      [right, bottom],
    ],
    5: [[left, top], [right, top], center, [left, bottom], [right, bottom]],
    6: [
      [left, top],
      [right, top],
      [left, 0],
      [right, 0],
      [left, bottom],
      [right, bottom],
    ],
  };
  return positions[value] ?? [];
}

export function createRollToken(options: RollTokenOptions): RollTokenVisual {
  const root = new Container();
  const shadow = new Graphics()
    .ellipse(0, options.size * 0.46, options.size * 0.42, options.size * 0.12)
    .fill({ color: options.shadow, alpha: 0.28 });
  const face = new Graphics(faceContext(options));
  const value = new Text({
    text: "",
    style: new TextStyle({
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: options.size * 0.38,
      fontWeight: "700",
      fill: options.foreground,
      align: "center",
    }),
  });
  value.anchor.set(0.5);
  const pips = Array.from({ length: 6 }, (_, index) => {
    const pipsForValue = new Graphics();
    for (const [x, y] of pipPositions(index + 1)) {
      pipsForValue
        .circle(x * options.size, y * options.size, options.size * 0.055)
        .fill(options.foreground);
    }
    pipsForValue.visible = false;
    return pipsForValue;
  });
  const glint = new Graphics()
    .arc(0, 0, options.size * 0.37, -2.45, -1.05)
    .stroke({ color: options.foreground, width: 2, alpha: 0.72 });
  glint.alpha = 0;
  root.addChild(shadow, face, ...pips, value, glint);
  return {
    root,
    face,
    shadow,
    value,
    pips,
    glint,
    sides: options.sides,
  };
}

export function setRollTokenValue(visual: RollTokenVisual, value: number | string): void {
  for (const pip of visual.pips) pip.visible = false;
  if (visual.sides === 6 && typeof value === "number") {
    const pip = visual.pips[value - 1];
    if (pip) {
      pip.visible = true;
      visual.value.visible = false;
      return;
    }
  }
  visual.value.visible = true;
  visual.value.text = String(value);
}
