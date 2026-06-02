import { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical, Maximize2, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCompanionStore } from "@/stores/useCompanionStore";
import type { CompanionPlayer, CompanionSession } from "@/stores/useCompanionStore.types";
import { PlayerTile } from "./PlayerTile";
import { getCompanionSlots } from "./layouts/slots";

interface CompanionBoardProps {
  session: CompanionSession;
}

export function CompanionBoard({ session }: CompanionBoardProps) {
  if (session.layout === "free") {
    return <FreeBoard session={session} />;
  }
  return <GridBoard session={session} />;
}

function GridBoard({ session }: CompanionBoardProps) {
  const { slots, template } = getCompanionSlots(session.layout, session.players.length);
  return (
    <div
      className="grid size-full gap-1 p-1 sm:gap-2 sm:p-2 md:gap-3 md:p-3"
      style={{
        gridTemplate: template,
      }}
    >
      {session.players.map((player, index) => {
        const slot = slots[index];
        if (!slot) return null;
        return (
          <div key={player.id} style={{ gridArea: slot.gridArea }} className="min-h-0 min-w-0">
            <PlayerTile
              player={player}
              opponents={session.players.filter((p) => p.id !== player.id)}
              rotation={slot.rotation}
              commanderRules={session.commanderRules}
              isActive={session.activePlayerId === player.id}
            />
          </div>
        );
      })}
    </div>
  );
}

function FreeBoard({ session }: CompanionBoardProps) {
  const setFreePosition = useCompanionStore((s) => s.setFreePosition);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [bounds, setBounds] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      setBounds({ w: el.clientWidth, h: el.clientHeight });
    });
    obs.observe(el);
    setBounds({ w: el.clientWidth, h: el.clientHeight });
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative size-full overflow-hidden bg-gradient-to-br from-muted/20 to-background"
    >
      {session.players.map((player, index) => {
        const pos = ensureFreePos(player, index, session.players.length, bounds);
        return (
          <FreeTile
            key={player.id}
            player={player}
            opponents={session.players.filter((p) => p.id !== player.id)}
            commanderRules={session.commanderRules}
            isActive={session.activePlayerId === player.id}
            position={pos}
            bounds={bounds}
            containerRef={containerRef}
            onMove={(next) => setFreePosition(player.id, next)}
          />
        );
      })}
    </div>
  );
}

function ensureFreePos(
  player: CompanionPlayer,
  index: number,
  total: number,
  bounds: { w: number; h: number } | null,
): { x: number; y: number; rotation: number; scale: number } {
  if (player.freeLayout) {
    return { ...player.freeLayout, scale: player.freeLayout.scale ?? 1 };
  }
  if (!bounds) return { x: 0, y: 0, rotation: 0, scale: 1 };
  const cols = Math.ceil(Math.sqrt(total));
  const rows = Math.ceil(total / cols);
  const cellW = bounds.w / cols;
  const cellH = bounds.h / rows;
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: col * cellW + 10,
    y: row * cellH + 10,
    rotation: row === 0 && rows > 1 ? 180 : 0,
    scale: 1,
  };
}

interface FreeTileProps {
  player: CompanionPlayer;
  opponents: CompanionPlayer[];
  commanderRules: boolean;
  isActive: boolean;
  position: { x: number; y: number; rotation: number; scale: number };
  bounds: { w: number; h: number } | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onMove: (pos: { x: number; y: number; rotation: number; scale: number }) => void;
}

const ROTATION_SNAP_DEG = 15;
const ROTATION_DRAG_THRESHOLD_DEG = 4;
const SCALE_MIN = 0.55;
const SCALE_MAX = 2;
const SCALE_SNAP = 0.05;
const SCALE_DRAG_THRESHOLD_PX = 6;
const BODY_DRAG_THRESHOLD_PX = 8;
const BASE_TILE_WIDTH = 360;
const BASE_TILE_HEIGHT = 220;

function FreeTile({
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
  const bodyDrag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    dragging: boolean;
    innerTarget: Element | null;
    fromHandle: boolean;
  } | null>(null);

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
      onMove({
        x: position.x,
        y: position.y,
        rotation: position.rotation,
        scale: clamped,
      });
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

  const onBodyPointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const target = event.target instanceof Element ? event.target : null;
      const fromHandle = Boolean(target?.closest("[data-companion-handle]"));
      bodyDrag.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        origX: position.x,
        origY: position.y,
        dragging: false,
        innerTarget: target,
        fromHandle,
      };
    },
    [position.x, position.y],
  );

  const onBodyPointerMoveCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const state = bodyDrag.current;
      if (!state || state.fromHandle || event.pointerId !== state.pointerId) return;
      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;

      if (!state.dragging) {
        if (Math.hypot(dx, dy) < BODY_DRAG_THRESHOLD_PX) return;
        state.dragging = true;
        if (state.innerTarget) {
          try {
            state.innerTarget.releasePointerCapture(event.pointerId);
          } catch {
            /* ignore — element may not hold the capture */
          }
          state.innerTarget.dispatchEvent(
            new PointerEvent("pointercancel", { pointerId: event.pointerId, bubbles: true }),
          );
        }
        event.currentTarget.setPointerCapture(event.pointerId);
      }

      event.stopPropagation();
      if (!bounds) return;
      const x = clamp(state.origX + dx, 0, bounds.w - tileWidth);
      const y = clamp(state.origY + dy, 0, bounds.h - tileHeight);
      onMove({ x, y, rotation: position.rotation, scale: position.scale });
    },
    [bounds, onMove, position.rotation, position.scale, tileHeight, tileWidth],
  );

  const onBodyPointerUpCapture = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const state = bodyDrag.current;
    if (!state || event.pointerId !== state.pointerId) return;
    bodyDrag.current = null;
    if (state.dragging) {
      event.stopPropagation();
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
    }
  }, []);

  const isPerpendicular = Math.abs(position.rotation) === 90;
  const cardWidth = isPerpendicular ? tileHeight : tileWidth;
  const cardHeight = isPerpendicular ? tileWidth : tileHeight;

  return (
    <div
      className="absolute touch-none"
      style={{ left: position.x, top: position.y, width: tileWidth, height: tileHeight }}
      onPointerDownCapture={onBodyPointerDownCapture}
      onPointerMoveCapture={onBodyPointerMoveCapture}
      onPointerUpCapture={onBodyPointerUpCapture}
      onPointerCancelCapture={onBodyPointerUpCapture}
    >
      <div className="relative size-full">
        <PlayerTile
          player={player}
          opponents={opponents}
          rotation={position.rotation}
          commanderRules={commanderRules}
          isActive={isActive}
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
