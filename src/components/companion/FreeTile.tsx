import { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical, Maximize2, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCompanionStore } from "@/stores/useCompanionStore";
import type { CompanionPlayer } from "@/stores/useCompanionStore.types";
import { PlayerTile } from "./PlayerTile";

const TAP_MAX_DURATION_MS = 220;
const TAP_MAX_MOTION_PX = 4;
const HOLD_DELAY_MS = 320;
const HOLD_INTERVAL_MS = 110;
const ROTATION_SNAP_DEG = 15;
const ROTATION_DRAG_THRESHOLD_DEG = 4;
const SCALE_MIN = 0.55;
const SCALE_MAX = 2;
const SCALE_SNAP = 0.05;
const SCALE_DRAG_THRESHOLD_PX = 6;
const BASE_TILE_WIDTH = 360;
const BASE_TILE_HEIGHT = 220;

export interface FreeTilePosition {
  x: number;
  y: number;
  rotation: number;
  scale: number;
}

interface FreeTileProps {
  player: CompanionPlayer;
  opponents: CompanionPlayer[];
  commanderRules: boolean;
  isActive: boolean;
  position: FreeTilePosition;
  bounds: { w: number; h: number } | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onMove: (pos: FreeTilePosition) => void;
}

export function FreeTile({
  player,
  opponents,
  commanderRules,
  isActive,
  position,
  bounds,
  containerRef,
  onMove,
}: FreeTileProps) {
  const dragStart = useRef<{
    pointerX: number;
    pointerY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const rotateStart = useRef<{
    centerX: number;
    centerY: number;
    pointerAngle: number;
    origRotation: number;
    moved: boolean;
  } | null>(null);
  const scaleStart = useRef<{
    centerX: number;
    centerY: number;
    origDist: number;
    origScale: number;
    moved: boolean;
  } | null>(null);
  const bodyPress = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    pressTime: number;
    origX: number;
    origY: number;
    half: "left" | "right";
    maxMotion: number;
    holdTimer: ReturnType<typeof setTimeout> | null;
    tickTimer: ReturnType<typeof setInterval> | null;
    holding: boolean;
  } | null>(null);
  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{
    origDist: number;
    origAngle: number;
    origScale: number;
    origRotation: number;
  } | null>(null);
  const adjustLifeStore = useCompanionStore((s) => s.adjustLife);
  const [decTick, setDecTick] = useState(0);
  const [incTick, setIncTick] = useState(0);

  const baseWidth = bounds ? Math.min(BASE_TILE_WIDTH, bounds.w * 0.45) : BASE_TILE_WIDTH - 40;
  const baseHeight = bounds ? Math.min(BASE_TILE_HEIGHT, bounds.h * 0.45) : BASE_TILE_HEIGHT - 20;
  const tileWidth = baseWidth * position.scale;
  const tileHeight = baseHeight * position.scale;

  const onMovePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      dragStart.current = {
        pointerX: event.clientX,
        pointerY: event.clientY,
        origX: position.x,
        origY: position.y,
      };
    },
    [position],
  );

  const onMovePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragStart.current || !bounds) return;
      const dx = event.clientX - dragStart.current.pointerX;
      const dy = event.clientY - dragStart.current.pointerY;
      const x = clamp(dragStart.current.origX + dx, 0, bounds.w - tileWidth);
      const y = clamp(dragStart.current.origY + dy, 0, bounds.h - tileHeight);
      onMove({ x, y, rotation: position.rotation, scale: position.scale });
    },
    [bounds, onMove, position.rotation, position.scale, tileHeight, tileWidth],
  );

  const onMovePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragStart.current = null;
  }, []);

  const onRotatePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.stopPropagation();
      const container = containerRef.current;
      if (!container) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const rect = container.getBoundingClientRect();
      const centerX = rect.left + position.x + tileWidth / 2;
      const centerY = rect.top + position.y + tileHeight / 2;
      const pointerAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
      rotateStart.current = {
        centerX,
        centerY,
        pointerAngle,
        origRotation: position.rotation,
        moved: false,
      };
    },
    [containerRef, position, tileHeight, tileWidth],
  );

  const onRotatePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const start = rotateStart.current;
      if (!start) return;
      event.stopPropagation();
      const currentAngle = Math.atan2(event.clientY - start.centerY, event.clientX - start.centerX);
      const deltaDeg = ((currentAngle - start.pointerAngle) * 180) / Math.PI;
      if (!start.moved && Math.abs(deltaDeg) < ROTATION_DRAG_THRESHOLD_DEG) return;
      start.moved = true;
      const raw = start.origRotation + deltaDeg;
      const snapped = Math.round(raw / ROTATION_SNAP_DEG) * ROTATION_SNAP_DEG;
      const normalised = normaliseDegrees(snapped);
      onMove({ x: position.x, y: position.y, rotation: normalised, scale: position.scale });
    },
    [onMove, position.scale, position.x, position.y],
  );

  const onRotatePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.stopPropagation();
      event.currentTarget.releasePointerCapture(event.pointerId);
      const start = rotateStart.current;
      rotateStart.current = null;
      if (start && !start.moved) {
        const next = nextQuarterTurn(position.rotation);
        onMove({ x: position.x, y: position.y, rotation: next, scale: position.scale });
      }
    },
    [onMove, position.rotation, position.scale, position.x, position.y],
  );

  const onScalePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.stopPropagation();
      const container = containerRef.current;
      if (!container) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const rect = container.getBoundingClientRect();
      const centerX = rect.left + position.x + tileWidth / 2;
      const centerY = rect.top + position.y + tileHeight / 2;
      const dx = event.clientX - centerX;
      const dy = event.clientY - centerY;
      const origDist = Math.max(8, Math.hypot(dx, dy));
      scaleStart.current = {
        centerX,
        centerY,
        origDist,
        origScale: position.scale,
        moved: false,
      };
    },
    [containerRef, position.scale, position.x, position.y, tileHeight, tileWidth],
  );

  const onScalePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const start = scaleStart.current;
      if (!start) return;
      event.stopPropagation();
      const dx = event.clientX - start.centerX;
      const dy = event.clientY - start.centerY;
      const dist = Math.hypot(dx, dy);
      if (!start.moved && Math.abs(dist - start.origDist) < SCALE_DRAG_THRESHOLD_PX) return;
      start.moved = true;
      const ratio = dist / start.origDist;
      const raw = start.origScale * ratio;
      const snapped = Math.round(raw / SCALE_SNAP) * SCALE_SNAP;
      const clamped = clamp(snapped, SCALE_MIN, SCALE_MAX);
      onMove({ x: position.x, y: position.y, rotation: position.rotation, scale: clamped });
    },
    [onMove, position.rotation, position.x, position.y],
  );

  const onScalePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.stopPropagation();
      event.currentTarget.releasePointerCapture(event.pointerId);
      const start = scaleStart.current;
      scaleStart.current = null;
      if (start && !start.moved) {
        onMove({ x: position.x, y: position.y, rotation: position.rotation, scale: 1 });
      }
    },
    [onMove, position.rotation, position.x, position.y],
  );

  const cleanupBodyTimers = useCallback((state: NonNullable<typeof bodyPress.current>) => {
    if (state.holdTimer) {
      clearTimeout(state.holdTimer);
      state.holdTimer = null;
    }
    if (state.tickTimer) {
      clearInterval(state.tickTimer);
      state.tickTimer = null;
    }
  }, []);

  const onBodyPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-companion-handle]")) return;
      if (
        target?.closest("input, textarea, button, [role='menu'], [data-companion-no-body-drag]")
      ) {
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (activePointers.current.size >= 2) {
        if (bodyPress.current) {
          cleanupBodyTimers(bodyPress.current);
          bodyPress.current = null;
        }
        const [a, b] = Array.from(activePointers.current.values());
        pinch.current = {
          origDist: Math.max(8, Math.hypot(b.x - a.x, b.y - a.y)),
          origAngle: Math.atan2(b.y - a.y, b.x - a.x),
          origScale: position.scale,
          origRotation: position.rotation,
        };
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const half: "left" | "right" = event.clientX - rect.left < rect.width / 2 ? "left" : "right";
      const state = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        pressTime: Date.now(),
        origX: position.x,
        origY: position.y,
        half,
        maxMotion: 0,
        holdTimer: null as ReturnType<typeof setTimeout> | null,
        tickTimer: null as ReturnType<typeof setInterval> | null,
        holding: false,
      };
      bodyPress.current = state;
      state.holdTimer = setTimeout(() => {
        if (bodyPress.current !== state || state.maxMotion >= TAP_MAX_MOTION_PX) return;
        state.holding = true;
        adjustLifeStore(player.id, half === "left" ? -1 : 1);
        if (half === "left") setDecTick((t) => t + 1);
        else setIncTick((t) => t + 1);
        state.tickTimer = setInterval(() => {
          if (bodyPress.current !== state || state.maxMotion >= TAP_MAX_MOTION_PX) return;
          adjustLifeStore(player.id, half === "left" ? -1 : 1);
          if (half === "left") setDecTick((t) => t + 1);
          else setIncTick((t) => t + 1);
        }, HOLD_INTERVAL_MS);
      }, HOLD_DELAY_MS);
    },
    [
      adjustLifeStore,
      cleanupBodyTimers,
      player.id,
      position.x,
      position.y,
      position.scale,
      position.rotation,
    ],
  );

  const onBodyPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (activePointers.current.has(event.pointerId)) {
        activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      if (pinch.current && activePointers.current.size >= 2) {
        const [a, b] = Array.from(activePointers.current.values());
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const rawScale = pinch.current.origScale * (dist / pinch.current.origDist);
        const scale = clamp(Math.round(rawScale / SCALE_SNAP) * SCALE_SNAP, SCALE_MIN, SCALE_MAX);
        const deltaDeg = ((angle - pinch.current.origAngle) * 180) / Math.PI;
        const rawRotation = pinch.current.origRotation + deltaDeg;
        const rotation = normaliseDegrees(
          Math.round(rawRotation / ROTATION_SNAP_DEG) * ROTATION_SNAP_DEG,
        );
        onMove({ x: position.x, y: position.y, rotation, scale });
        return;
      }
      const state = bodyPress.current;
      if (!state || event.pointerId !== state.pointerId) return;
      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;
      const dist = Math.hypot(dx, dy);
      if (dist > state.maxMotion) state.maxMotion = dist;
      if (state.holding) return;
      if (!bounds) return;
      const x = clamp(state.origX + dx, 0, bounds.w - tileWidth);
      const y = clamp(state.origY + dy, 0, bounds.h - tileHeight);
      onMove({ x, y, rotation: position.rotation, scale: position.scale });
    },
    [
      bounds,
      onMove,
      position.rotation,
      position.scale,
      position.x,
      position.y,
      tileHeight,
      tileWidth,
    ],
  );

  const onBodyPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const wasPinch = pinch.current != null;
      activePointers.current.delete(event.pointerId);
      if (activePointers.current.size < 2) pinch.current = null;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
      if (wasPinch) {
        if (bodyPress.current) {
          cleanupBodyTimers(bodyPress.current);
          bodyPress.current = null;
        }
        return;
      }
      const state = bodyPress.current;
      if (!state || event.pointerId !== state.pointerId) return;
      bodyPress.current = null;
      cleanupBodyTimers(state);
      const wasTap =
        !state.holding &&
        state.maxMotion < TAP_MAX_MOTION_PX &&
        Date.now() - state.pressTime < TAP_MAX_DURATION_MS;
      if (wasTap) {
        if (state.maxMotion > 0) {
          onMove({
            x: state.origX,
            y: state.origY,
            rotation: position.rotation,
            scale: position.scale,
          });
        }
        adjustLifeStore(player.id, state.half === "left" ? -1 : 1);
        if (state.half === "left") setDecTick((t) => t + 1);
        else setIncTick((t) => t + 1);
      }
    },
    [adjustLifeStore, cleanupBodyTimers, onMove, player.id, position.rotation, position.scale],
  );

  useEffect(() => {
    return () => {
      if (bodyPress.current) cleanupBodyTimers(bodyPress.current);
    };
  }, [cleanupBodyTimers]);

  const onBodyKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      let delta = 0;
      if (event.key === "ArrowLeft" || event.key === "-") delta = -1;
      else if (event.key === "ArrowRight" || event.key === "+" || event.key === "=") delta = 1;
      else if (event.key === "ArrowDown") delta = -5;
      else if (event.key === "ArrowUp") delta = 5;
      else return;
      event.preventDefault();
      adjustLifeStore(player.id, delta);
      if (delta < 0) setDecTick((t) => t + 1);
      else setIncTick((t) => t + 1);
    },
    [adjustLifeStore, player.id],
  );

  const isPerpendicular = Math.abs(position.rotation) === 90;
  const cardWidth = isPerpendicular ? tileHeight : tileWidth;
  const cardHeight = isPerpendicular ? tileWidth : tileHeight;

  return (
    <div
      className="absolute touch-none select-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-white"
      style={{ left: position.x, top: position.y, width: tileWidth, height: tileHeight }}
      role="group"
      aria-label={`${player.name} tile — left/right arrows or +/- to adjust life`}
      tabIndex={0}
      onPointerDown={onBodyPointerDown}
      onPointerMove={onBodyPointerMove}
      onPointerUp={onBodyPointerUp}
      onPointerCancel={onBodyPointerUp}
      onKeyDown={onBodyKeyDown}
    >
      <div className="relative size-full">
        <PlayerTile
          player={player}
          opponents={opponents}
          rotation={position.rotation}
          commanderRules={commanderRules}
          isActive={isActive}
          externalLifeInput
          externalDecTick={decTick}
          externalIncTick={incTick}
        />
        <div
          className="pointer-events-none absolute z-40"
          style={{
            top: "50%",
            left: "50%",
            width: cardWidth,
            height: cardHeight,
            transform: `translate(-50%, -50%) rotate(${position.rotation}deg)`,
          }}
        >
          <div className="pointer-events-auto absolute bottom-1 left-1/2 flex -translate-x-1/2 gap-1 opacity-70 transition-opacity hover:opacity-100">
            <div
              role="button"
              aria-label="Rotate tile"
              title="Tap to rotate 90° · drag to free-rotate"
              data-companion-handle
              className={cn(
                "grid size-7 cursor-grab touch-none place-items-center rounded-md bg-black/60 text-white",
                "active:cursor-grabbing",
              )}
              onPointerDown={onRotatePointerDown}
              onPointerMove={onRotatePointerMove}
              onPointerUp={onRotatePointerUp}
              onPointerCancel={onRotatePointerUp}
            >
              <RotateCw className="size-4" />
            </div>
            <div
              role="button"
              aria-label="Scale tile"
              title="Drag to resize · tap to reset"
              data-companion-handle
              className="grid size-7 cursor-grab touch-none place-items-center rounded-md bg-black/60 text-white active:cursor-grabbing"
              onPointerDown={onScalePointerDown}
              onPointerMove={onScalePointerMove}
              onPointerUp={onScalePointerUp}
              onPointerCancel={onScalePointerUp}
            >
              <Maximize2 className="size-4" />
            </div>
            <div
              role="button"
              aria-label="Drag tile"
              data-companion-handle
              className="grid size-7 cursor-grab touch-none place-items-center rounded-md bg-black/60 text-white active:cursor-grabbing"
              onPointerDown={onMovePointerDown}
              onPointerMove={onMovePointerMove}
              onPointerUp={onMovePointerUp}
              onPointerCancel={onMovePointerUp}
            >
              <GripVertical className="size-4" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function normaliseDegrees(deg: number): number {
  let value = deg % 360;
  if (value > 180) value -= 360;
  if (value <= -180) value += 360;
  return value;
}

function nextQuarterTurn(current: number): number {
  const normalised = normaliseDegrees(Math.round(current / 90) * 90);
  if (normalised === 0) return 90;
  if (normalised === 90) return 180;
  if (normalised === 180) return -90;
  return 0;
}
