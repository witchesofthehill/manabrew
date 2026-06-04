import { useEffect, useRef, useState } from "react";
import { useCompanionStore } from "@/stores/useCompanionStore";
import type { CompanionPlayer, CompanionSession } from "@/stores/useCompanionStore.types";
import { FreeTile, type FreeTilePosition } from "./FreeTile";
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
      style={{ gridTemplate: template }}
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
): FreeTilePosition {
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
