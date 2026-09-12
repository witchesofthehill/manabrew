import { Container, Graphics, GraphicsContext, Text, TextStyle } from "pixi.js";

export interface RollTokenVisual {
  root: Container;
  pips: Graphics;
  pipFaces: GraphicsContext[];
  value: Text;
  sides: number;
}

interface RollTokenOptions {
  sides: number;
  size: number;
  fill: string;
  border: string;
  foreground: string;
}

const contexts = new Map<string, GraphicsContext>();
const pipContexts = new Map<string, GraphicsContext>();

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
  const key = [sides, options.size, options.fill, options.border].join(":");
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
  }
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

function pipContext(size: number, foreground: string, value: number): GraphicsContext {
  const key = [size, foreground, value].join(":");
  const cached = pipContexts.get(key);
  if (cached) return cached;
  const context = new GraphicsContext();
  for (const [x, y] of pipPositions(value)) {
    context.circle(x * size, y * size, size * 0.055).fill(foreground);
  }
  pipContexts.set(key, context);
  return context;
}

export function createRollToken(options: RollTokenOptions): RollTokenVisual {
  const root = new Container();
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
  const pipFaces = Array.from({ length: 6 }, (_, index) =>
    pipContext(options.size, options.foreground, index + 1),
  );
  const pips = new Graphics(pipFaces[0]);
  pips.visible = false;
  root.addChild(face, pips, value);
  return {
    root,
    pips,
    pipFaces,
    value,
    sides: options.sides,
  };
}

export function setRollTokenValue(visual: RollTokenVisual, value: number | string): void {
  visual.pips.visible = false;
  if (visual.sides === 6 && typeof value === "number") {
    const face = visual.pipFaces[value - 1];
    if (face) {
      visual.pips.context = face;
      visual.pips.visible = true;
      visual.value.visible = false;
      return;
    }
  }
  visual.value.visible = true;
  visual.value.text = String(value);
}
