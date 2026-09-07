type Point = { x: number; y: number };
type Origin = { corners: Point[]; time: number };
const origins = new WeakMap<Element, Map<string, Origin>>();

export function recordCastOrigin(root: Element, id: string, corners: Point[]) {
  let cards = origins.get(root);
  if (!cards) origins.set(root, (cards = new Map()));
  const now = performance.now();
  cards.set(id, { corners, time: now });
  for (const [key, origin] of cards) if (now - origin.time > 1500) cards.delete(key);
}

export function takeCastOrigin(root: Element, id: string) {
  const cards = origins.get(root);
  const origin = cards?.get(id);
  cards?.delete(id);
  return origin && performance.now() - origin.time < 1500 ? origin : undefined;
}

export function cardScreenTransform(corners: Point[], width: number, height: number) {
  const [a, b, c] = corners;
  return `matrix(${(b.x - a.x) / width},${(b.y - a.y) / width},${(c.x - a.x) / height},${(c.y - a.y) / height},${a.x},${a.y})`;
}
