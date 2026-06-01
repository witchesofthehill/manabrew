import { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
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
      className="grid size-full gap-3 p-3"
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
): { x: number; y: number; rotation: number } {
  if (player.freeLayout) return player.freeLayout;
  if (!bounds) return { x: 0, y: 0, rotation: 0 };
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
  };
}

interface FreeTileProps {
  player: CompanionPlayer;
  opponents: CompanionPlayer[];
  commanderRules: boolean;
  isActive: boolean;
  position: { x: number; y: number; rotation: number };
  bounds: { w: number; h: number } | null;
  onMove: (pos: { x: number; y: number; rotation: number }) => void;
}

function FreeTile({
  player,
  opponents,
  commanderRules,
  isActive,
  position,
  bounds,
  onMove,
}: FreeTileProps) {
  const dragStart = useRef<{
    pointerX: number;
    pointerY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const tileWidth = bounds ? Math.min(360, bounds.w * 0.45) : 320;
  const tileHeight = bounds ? Math.min(220, bounds.h * 0.45) : 200;

  const onPointerDown = useCallback(
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

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragStart.current || !bounds) return;
      const dx = event.clientX - dragStart.current.pointerX;
      const dy = event.clientY - dragStart.current.pointerY;
      const x = clamp(dragStart.current.origX + dx, 0, bounds.w - tileWidth);
      const y = clamp(dragStart.current.origY + dy, 0, bounds.h - tileHeight);
      onMove({ x, y, rotation: position.rotation });
    },
    [bounds, onMove, position.rotation, tileHeight, tileWidth],
  );

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragStart.current = null;
  }, []);

  return (
    <div
      className="absolute"
      style={{ left: position.x, top: position.y, width: tileWidth, height: tileHeight }}
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
          role="button"
          aria-label="Drag tile"
          className={cn(
            "absolute right-1 top-1 z-40 grid size-7 cursor-grab place-items-center rounded-md bg-black/60 text-white opacity-0 transition-opacity",
            "hover:opacity-100 [.group:hover_&]:opacity-100",
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <GripVertical className="size-4" />
        </div>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}
