import { useState } from "react";
import { PHASE_BAR_ENTRIES, PHASES } from "@/components/game/game.constants";
import { togglePhaseStops } from "@/components/game/game.utils";
import { useIsTouch } from "@/hooks/useBreakpoints";
import { useTheme } from "@/hooks/useTheme";
import { compositeThemeColor, readableTextColor, withAlpha } from "@/themes/gameTheme";
import { PhaseStopCompactAnnotations } from "./PhaseStopCompactAnnotations";
import {
  BOTTOM_MARKER_Y,
  COMPACT_VIEW,
  MARKER_HEIGHT,
  markerBox,
  tileX,
  TILE_HEIGHT,
  TILE_WIDTH,
  TILE_Y,
  TOP_MARKER_Y,
} from "./phaseStopCompact.utils";
import {
  hasStop,
  overlayBox,
  STOP_DIAGRAM_TARGET,
  STOP_DIAGRAM_TILE_LABEL,
  viewBox,
  type PhaseStopDiagramProps,
} from "./phaseStopDiagram.utils";

const TARGET_HEIGHT = 28;
const GHOST_MIX = 0.35;

export function PhaseStopCompactDiagram({ players, step, turnColor }: PhaseStopDiagramProps) {
  const { gameTheme } = useTheme();
  const touch = useIsTouch();
  const [hovered, setHovered] = useState<number | null>(null);
  const surface = gameTheme.phaseStrip.background;
  const ink = readableTextColor(surface, gameTheme.canvas.shadow, gameTheme.textOnTinted);
  const turnInk = readableTextColor(turnColor, gameTheme.canvas.shadow, gameTheme.textOnTinted);
  const stepShort = PHASES.find((phase) => phase.id === step)?.short;
  const opponentCount = players.length - 1;
  const hoverProps = (index: number) => ({
    onPointerEnter: () => setHovered(index),
    onPointerLeave: () => setHovered(null),
  });

  return (
    <div className="relative">
      <svg className="block h-auto w-full" viewBox={viewBox(COMPACT_VIEW)} aria-hidden>
        {PHASE_BAR_ENTRIES.map((entry, index) => {
          const current = entry.steps.includes(step);
          return (
            <g key={entry.id}>
              <rect
                x={tileX(index)}
                y={TILE_Y}
                width={TILE_WIDTH}
                height={TILE_HEIGHT}
                rx={8}
                fill={current ? turnColor : surface}
              />
              <text
                x={tileX(index) + TILE_WIDTH / 2}
                y={TILE_Y + TILE_HEIGHT / 2}
                textAnchor="middle"
                dominantBaseline="central"
                className={STOP_DIAGRAM_TILE_LABEL}
                fill={current ? turnInk : ink}
              >
                {current && stepShort ? stepShort : entry.short}
              </text>
              {players.map((player, playerIndex) => {
                const enabled = hasStop(entry, player);
                if (!enabled && hovered !== index && !touch) return null;
                const { x, width } = markerBox(index, playerIndex, opponentCount);
                return (
                  <rect
                    key={player.id}
                    x={x}
                    y={playerIndex === 0 ? BOTTOM_MARKER_Y : TOP_MARKER_Y}
                    width={width}
                    height={MARKER_HEIGHT}
                    rx={MARKER_HEIGHT / 2}
                    fill={
                      enabled
                        ? player.color
                        : compositeThemeColor(withAlpha(player.color, GHOST_MIX), surface)
                    }
                  />
                );
              })}
            </g>
          );
        })}
        <PhaseStopCompactAnnotations players={players} />
      </svg>
      {PHASE_BAR_ENTRIES.map((entry, index) => (
        <div key={entry.id}>
          <div
            className="absolute"
            style={overlayBox(COMPACT_VIEW, tileX(index), TILE_Y, TILE_WIDTH, TILE_HEIGHT)}
            {...hoverProps(index)}
          />
          {players.map((player, playerIndex) => {
            const self = playerIndex === 0;
            const targetWidth = self ? TILE_WIDTH : TILE_WIDTH / opponentCount;
            return (
              <button
                key={player.id}
                type="button"
                aria-label={`${player.name}: ${entry.label}, stop`}
                aria-pressed={hasStop(entry, player)}
                className={STOP_DIAGRAM_TARGET}
                style={overlayBox(
                  COMPACT_VIEW,
                  tileX(index) + (self ? 0 : (playerIndex - 1) * targetWidth),
                  self ? TILE_Y + TILE_HEIGHT : TILE_Y - TARGET_HEIGHT,
                  targetWidth,
                  TARGET_HEIGHT,
                )}
                onClick={() => togglePhaseStops(entry.steps, player.stops, player.toggle)}
                onFocus={() => setHovered(index)}
                onBlur={() => setHovered(null)}
                {...hoverProps(index)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
