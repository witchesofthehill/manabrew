import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent, PointerEvent, RefObject } from "react";
import { LIMITED_DRAG_THRESHOLD } from "@/pixi/limited/limitedLayout";
import type {
  LimitedBoosterReveal,
  BoosterTearDirection,
} from "@/pixi/limited/LimitedBoosterReveal";
import { haptic } from "@/lib/haptics";

interface PackGesture {
  pointerId: number;
  target: HTMLButtonElement;
  startX: number;
  startY: number;
  x: number;
  dragged: boolean;
  ids: Set<string>;
  bounds: Map<string, DOMRect>;
  laneY: number;
}

export function useLimitedBoosterGesture(
  buttons: RefObject<Map<string, HTMLButtonElement>>,
  disabled: boolean,
  onOpen: (ids: string[], direction?: BoosterTearDirection) => void,
) {
  const packets = useRef(new Map<string, LimitedBoosterReveal>());
  const gesture = useRef<PackGesture | null>(null);
  const suppressClick = useRef<{ pointerId: number; until: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const reset = useCallback((restoreTears = true) => {
    const current = gesture.current;
    gesture.current = null;
    if (current?.target.hasPointerCapture(current.pointerId))
      current.target.releasePointerCapture(current.pointerId);
    if (restoreTears) for (const packet of packets.current.values()) packet.tear(0);
    setSelectedIds([]);
  }, []);
  useEffect(() => {
    const blur = () => reset();
    window.addEventListener("blur", blur);
    return () => window.removeEventListener("blur", blur);
  }, [reset]);
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (
      !current.dragged &&
      Math.hypot(event.clientX - current.startX, event.clientY - current.startY) <
        LIMITED_DRAG_THRESHOLD
    )
      return;
    const started = !current.dragged;
    current.dragged = true;
    const count = current.ids.size;
    const direction = event.clientX < current.x ? "left" : "right";
    const steps = Math.ceil(Math.abs(event.clientX - current.x) / LIMITED_DRAG_THRESHOLD);
    for (let step = 0; steps && step <= steps; step++) {
      const x = current.x + ((event.clientX - current.x) * step) / steps;
      const target = document
        .elementFromPoint(x, current.laneY)
        ?.closest<HTMLButtonElement>("button[data-limited-pack-id]");
      const id = target?.dataset.limitedPackId;
      if (id && buttons.current.get(id) === target) current.ids.add(id);
    }
    for (const id of current.ids) {
      const rect = current.bounds.get(id)!;
      const progress = Math.max(
        direction === "right"
          ? (event.clientX - rect.left) / rect.width
          : (rect.right - event.clientX) / rect.width,
        Math.abs(event.clientY - current.startY) / rect.height,
      );
      packets.current.get(id)?.tear(Math.min(0.99, Math.max(0.15, progress)), direction);
    }
    current.x = event.clientX;
    if (current.ids.size !== count || started) {
      setSelectedIds([...current.ids]);
      haptic("select");
    }
  };
  return {
    packets,
    selectedIds,
    gesture,
    reset,
    handlers: {
      onClickCapture: (event: MouseEvent<HTMLDivElement>) => {
        const suppressed = suppressClick.current;
        suppressClick.current = null;
        if (
          suppressed &&
          performance.now() < suppressed.until &&
          (event.nativeEvent as globalThis.PointerEvent).pointerId === suppressed.pointerId
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        const target = (event.target as HTMLElement).closest<HTMLButtonElement>(
          "button[data-limited-pack-id]",
        );
        if (disabled || !target || !event.isPrimary || event.button !== 0 || gesture.current)
          return;
        target.setPointerCapture(event.pointerId);
        const bounds = new Map(
          [...buttons.current].map(([id, button]) => [id, button.getBoundingClientRect()]),
        );
        let top = -Infinity;
        let bottom = Infinity;
        for (const rect of bounds.values()) {
          top = Math.max(top, rect.top + LIMITED_DRAG_THRESHOLD);
          bottom = Math.min(bottom, rect.bottom - LIMITED_DRAG_THRESHOLD);
        }
        gesture.current = {
          pointerId: event.pointerId,
          target,
          startX: event.clientX,
          startY: event.clientY,
          x: event.clientX,
          dragged: false,
          ids: new Set([target.dataset.limitedPackId!]),
          bounds,
          laneY: Math.max(top, Math.min(bottom, event.clientY)),
        };
      },
      onPointerMove: move,
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
        if (gesture.current?.pointerId !== event.pointerId) return;
        move(event);
        const current = gesture.current;
        const ids = [...current.ids];
        const direction = event.clientX < current.startX ? "left" : "right";
        reset(!current.dragged);
        if (current.dragged) {
          suppressClick.current = { pointerId: event.pointerId, until: performance.now() + 500 };
          onOpen(ids, direction);
        }
      },
      onPointerCancel: () => reset(),
      onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => {
        if (gesture.current?.pointerId === event.pointerId) reset();
      },
    },
  };
}
