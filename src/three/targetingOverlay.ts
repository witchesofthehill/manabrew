import type { ArenaSceneProps } from "@/three/arena.types";

type Point = { x: number; y: number };
export function targetingOverlay(
  root: Element,
  live: { current: ArenaSceneProps },
  hitTarget: (event: PointerEvent) => string | null,
) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.classList.add("duel-target-arrows");
  svg.setAttribute("aria-hidden", "true");
  root.append(svg);
  let pointer: Point | null = null;
  let over: Element | null = null;
  let dragging = false;
  let aimed: string | null = null;
  let signature = "";
  const move = (event: PointerEvent) => {
    pointer = { x: event.clientX, y: event.clientY };
    over = event.target instanceof Element ? event.target : null;
  };
  const down = (event: PointerEvent) => {
    move(event);
    const stack = over?.closest<HTMLElement>("[data-stack-id]");
    dragging =
      event.button === 0 &&
      !!live.current.targeting &&
      stack?.dataset.stackId === live.current.targeting.stackId &&
      root.contains(stack ?? null);
    if (dragging) event.preventDefault();
  };
  const up = (event: PointerEvent) => {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const id =
      element?.closest<HTMLElement>("[data-target-id]")?.dataset.targetId ??
      element?.closest<HTMLElement>("[data-seat]")?.dataset.seat ??
      (element?.tagName === "CANVAS" ? hitTarget(event) : null);
    if (dragging && root.contains(element) && id && live.current.targeting?.candidates.includes(id))
      live.current.onCard(id);
    dragging = false;
  };
  const cancel = () => {
    dragging = false;
    pointer = null;
    aimed = null;
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key === "Escape") cancel();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerdown", down);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", escape);
  const center = (element: Element | null): Point | undefined => {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };
  const path = (d: string, className: string) => {
    const node = document.createElementNS(ns, "path");
    node.setAttribute("d", d);
    node.setAttribute("class", className);
    svg.append(node);
  };
  return {
    update(points: Map<string, Point>, hovered: string | null) {
      const targeting = live.current.targeting;
      const bounds = root.getBoundingClientRect();
      svg.style.display = targeting ? "block" : "none";
      if (!targeting) {
        cancel();
        signature = "";
        root
          .querySelectorAll("[data-targetable]")
          .forEach((el) => el.removeAttribute("data-targetable"));
        return;
      }
      const source =
        center(
          [...root.querySelectorAll<HTMLElement>("[data-stack-id]")].find(
            (el) => el.dataset.stackId === targeting.stackId,
          ) ?? null,
        ) ?? points.get(targeting.sourceId ?? "");
      const player = over?.closest<HTMLElement>("[data-seat]")?.dataset.seat;
      const option = over?.closest<HTMLElement>("[data-target-id]")?.dataset.targetId;
      const hover = option ?? player ?? (over?.tagName === "CANVAS" ? hovered : null);
      aimed = hover && targeting.candidates.includes(hover) ? hover : null;
      for (const el of root.querySelectorAll<HTMLElement>("[data-seat]")) {
        const point = center(el.querySelector("button") ?? el);
        if (point) points.set(el.dataset.seat!, point);
        el.dataset.targetable = String(targeting.candidates.includes(el.dataset.seat!));
      }
      const endpoints = targeting.selected.map((id) => ({ point: points.get(id), valid: true }));
      if (aimed && !targeting.selected.includes(aimed))
        endpoints.push({ point: points.get(aimed), valid: true });
      else if (
        !aimed &&
        (dragging || targeting.selected.length < (targeting.maxTargets ?? Infinity)) &&
        pointer &&
        root.contains(over) &&
        (dragging || over?.tagName === "CANVAS")
      )
        endpoints.push({ point: pointer, valid: false });
      const key = JSON.stringify([
        source,
        endpoints,
        bounds.width,
        bounds.height,
        bounds.left,
        bounds.top,
      ]);
      if (key === signature) return;
      signature = key;
      svg.replaceChildren();
      svg.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
      if (!source) return;
      for (const { point, valid } of endpoints) {
        if (!point) continue;
        const a = { x: source.x - bounds.left, y: source.y - bounds.top };
        const b = { x: point.x - bounds.left, y: point.y - bounds.top };
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length < 40) continue;
        const dx = (b.x - a.x) / length,
          dy = (b.y - a.y) / length;
        const end = { x: b.x - dx * 22, y: b.y - dy * 22 };
        const bend = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - Math.min(65, length * 0.12) };
        const d = `M${a.x},${a.y} Q${bend.x},${bend.y} ${end.x},${end.y}`;
        path(d, "target-line-glow");
        path(d, valid ? "target-line target-valid" : "target-line target-aim");
        const angle = Math.atan2(end.y - bend.y, end.x - bend.x);
        const ux = Math.cos(angle),
          uy = Math.sin(angle);
        path(
          `M${end.x - ux * 13 - uy * 6},${end.y - uy * 13 + ux * 6} L${end.x},${end.y} L${end.x - ux * 13 + uy * 6},${end.y - uy * 13 - ux * 6}`,
          "target-arrowhead",
        );
        const reticle = document.createElementNS(ns, "g");
        reticle.setAttribute("transform", `translate(${b.x},${b.y})`);
        reticle.setAttribute(
          "class",
          valid ? "target-reticle target-valid" : "target-reticle target-aim",
        );
        for (const radius of [15, 5]) {
          const ring = document.createElementNS(ns, "circle");
          ring.setAttribute("r", String(radius));
          reticle.append(ring);
        }
        const ticks = document.createElementNS(ns, "path");
        ticks.setAttribute("d", "M-22,0H-10 M10,0H22 M0,-22V-10 M0,10V22");
        reticle.append(ticks);
        svg.append(reticle);
      }
    },
    dispose() {
      svg.remove();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", escape);
    },
  };
}
