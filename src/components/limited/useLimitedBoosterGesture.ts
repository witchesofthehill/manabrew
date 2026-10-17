import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent, PointerEvent, RefObject } from "react";
import { LIMITED_DRAG_THRESHOLD } from "@/pixi/limited/limitedLayout";
import type { BoosterTearDirection } from "@/pixi/limited/LimitedBoosterReveal";
import { haptic } from "@/lib/haptics";
import type { LimitedBoosterDragEffects } from "@/pixi/limited/LimitedBoosterDragEffects";

interface PackGesture {
  pointerId: number;
  target: HTMLButtonElement;
  startX: number;
  startY: number;
  x: number;
  y: number;
  distance: number;
  dragged: boolean;
  ids: Set<string>;
  bounds: Map<string, DOMRect>;
}

export function useLimitedBoosterGesture(
  buttonsRef: RefObject<Map<string, HTMLButtonElement>>,
  disabled: boolean,
  onOpen: (ids: string[], direction?: BoosterTearDirection) => void,
  onTear: (id: string, progress: number, direction?: BoosterTearDirection) => void,
  effectsRef: RefObject<LimitedBoosterDragEffects | null>,
) {
  const gesture = useRef<PackGesture | null>(null);
  const callbacks = useRef({ onOpen, onTear });
  useLayoutEffect(() => {
    callbacks.current = { onOpen, onTear };
  });
  const suppressClick = useRef<{ pointerId: number; until: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const reset = useCallback(
    (restoreTears = true) => {
      const current = gesture.current;
      gesture.current = null;
      if (current?.target.hasPointerCapture(current.pointerId))
        current.target.releasePointerCapture(current.pointerId);
      if (restoreTears) {
        if (current)
          suppressClick.current = { pointerId: current.pointerId, until: performance.now() + 500 };
        for (const id of buttonsRef.current.keys()) callbacks.current.onTear(id, 0);
      }
      effectsRef.current?.stop(!restoreTears && Boolean(current?.dragged));
      setSelectedIds([]);
    },
    [buttonsRef, effectsRef],
  );
  useEffect(() => {
    const blur = () => reset();
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("blur", blur);
      reset();
    };
  }, [reset]);
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current) {
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "button[data-limited-pack-id]",
      );
      if (
        !disabled &&
        event.pointerType === "mouse" &&
        target &&
        buttonsRef.current.get(target.dataset.limitedPackId!) === target
      )
        effectsRef.current?.update(event.clientX, event.clientY, "hover");
      else effectsRef.current?.stop();
      return;
    }
    if (current.pointerId !== event.pointerId) return;
    if (
      !current.dragged &&
      Math.hypot(event.clientX - current.startX, event.clientY - current.startY) <
        LIMITED_DRAG_THRESHOLD
    ) {
      effectsRef.current?.update(event.clientX, event.clientY, "armed");
      return;
    }
    const started = !current.dragged;
    current.dragged = true;
    const count = current.ids.size;
    const direction = event.clientX < current.startX ? "left" : "right";
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    const distance = Math.hypot(dx, dy);
    current.distance += distance;
    const steps = Math.ceil(distance / LIMITED_DRAG_THRESHOLD);
    for (let step = 0; steps && step <= steps; step++) {
      const x = current.x + (dx * step) / steps;
      const y = current.y + (dy * step) / steps;
      const target = document
        .elementFromPoint(x, y)
        ?.closest<HTMLButtonElement>("button[data-limited-pack-id]");
      const id = target?.dataset.limitedPackId;
      if (id && buttonsRef.current.get(id) === target) current.ids.add(id);
    }
    for (const id of current.ids) {
      const rect = current.bounds.get(id)!;
      const progress = current.distance / rect.width;
      callbacks.current.onTear(id, Math.min(0.99, Math.max(0.15, progress)), direction);
    }
    current.x = event.clientX;
    current.y = event.clientY;
    effectsRef.current?.update(event.clientX, event.clientY, "drag");
    if (current.ids.size !== count || started) {
      setSelectedIds([...current.ids]);
      haptic("select");
    }
  };
  return {
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
          [...buttonsRef.current].map(([id, button]) => [id, button.getBoundingClientRect()]),
        );
        gesture.current = {
          pointerId: event.pointerId,
          target,
          startX: event.clientX,
          startY: event.clientY,
          x: event.clientX,
          y: event.clientY,
          distance: 0,
          dragged: false,
          ids: new Set([target.dataset.limitedPackId!]),
          bounds,
        };
        effectsRef.current?.update(event.clientX, event.clientY, "armed");
      },
      onPointerMove: move,
      onPointerLeave: () => {
        if (!gesture.current) effectsRef.current?.stop();
      },
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
        if (gesture.current?.pointerId !== event.pointerId) return;
        move(event);
        const current = gesture.current;
        const ids = [...current.ids];
        const direction = event.clientX < current.startX ? "left" : "right";
        reset(false);
        if (current.dragged) {
          suppressClick.current = { pointerId: event.pointerId, until: performance.now() + 500 };
          callbacks.current.onOpen(ids, direction);
        }
      },
      onPointerCancel: (event: PointerEvent<HTMLDivElement>) => {
        if (gesture.current?.pointerId === event.pointerId) reset();
      },
      onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => {
        if (gesture.current?.pointerId === event.pointerId) reset();
      },
    },
  };
}
