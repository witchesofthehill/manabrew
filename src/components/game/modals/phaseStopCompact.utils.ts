import { PHASE_BAR_ENTRIES } from "@/components/game/game.constants";
import type { PhaseStopArrow } from "./PhaseStopArrows";
import { hasStop, type DiagramView, type PhaseStopPlayer } from "./phaseStopDiagram.utils";

export const COMPACT_VIEW: DiagramView = { y: 0, width: 800, height: 400 };
export const TILE_WIDTH = 72;
export const TILE_HEIGHT = 64;
export const TILE_Y = 169;
export const MARKER_HEIGHT = 8;
export const TOP_MARKER_Y = 155;
export const BOTTOM_MARKER_Y = 239;
const BAR_X = 124;
const TILE_GAP = 8;
const LABEL_MIN_X = 340;
const LABEL_MAX_X = 460;

export const tileX = (index: number) => BAR_X + index * (TILE_WIDTH + TILE_GAP);

export function markerBox(index: number, playerIndex: number, opponentCount: number) {
  if (playerIndex === 0) return { x: tileX(index), width: TILE_WIDTH };
  const width = (TILE_WIDTH - (opponentCount - 1) * TILE_GAP) / opponentCount;
  return { x: tileX(index) + (playerIndex - 1) * (width + TILE_GAP), width };
}

export function stopArrows(players: readonly PhaseStopPlayer[], self: boolean): PhaseStopArrow[] {
  const opponentCount = players.length - 1;
  return players.flatMap((player, playerIndex) =>
    (playerIndex === 0) !== self
      ? []
      : PHASE_BAR_ENTRIES.flatMap((entry, index) => {
          if (!hasStop(entry, player)) return [];
          const { x, width } = markerBox(index, playerIndex, opponentCount);
          return [{ key: `${player.id}:${entry.id}`, x: x + width / 2, color: player.color }];
        }),
  );
}

export function labelX(arrows: readonly PhaseStopArrow[]): number {
  if (arrows.length === 0) return COMPACT_VIEW.width / 2;
  const xs = arrows.map((arrow) => arrow.x);
  const middle = (Math.min(...xs) + Math.max(...xs)) / 2;
  return Math.min(LABEL_MAX_X, Math.max(LABEL_MIN_X, middle));
}
