import type { CSSProperties } from "react";
import { PHASE_BAR_ENTRIES } from "@/components/game/game.constants";
import { togglePhaseStops } from "@/components/game/game.utils";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { readableTextColor } from "@/themes/gameTheme";
import { PhaseStopArrows } from "./PhaseStopArrows";
import {
  hasStop,
  overlayBox,
  phaseList,
  STOP_DIAGRAM_TARGET,
  STOP_DIAGRAM_TEXT,
  STOP_DIAGRAM_TILE_LABEL,
  STOP_DIAGRAM_TITLE,
  viewBox,
  type DiagramView,
  type PhaseEntry,
  type PhaseStopDiagramProps,
} from "./phaseStopDiagram.utils";

const WIDTH = 1120;
const FIRST_TILE_Y = 184;
const ROW_PITCH = 162;
const BOTTOM_PAD = 16;
const BAR_X = 36;
const TILE_WIDTH = 72;
const TILE_HEIGHT = 64;
const TILE_GAP = 8;
const NAME_OFFSET = 64;
const RAIL_OFFSET = 35;
const TIP_OFFSET = 5;
const DOT_X = 44;
const NAME_X = 68;
const LABEL_X = 640;
const RAIL_END = 626;
const MAX_NAME_LENGTH = 18;

const tileX = (index: number) => BAR_X + index * (TILE_WIDTH + TILE_GAP);
const tileY = (row: number) => FIRST_TILE_Y + row * ROW_PITCH;

function rowTitle(name: string, self: boolean): string {
  if (self) return "Your turn";
  const short = name.length > MAX_NAME_LENGTH ? `${name.slice(0, MAX_NAME_LENGTH - 1)}…` : name;
  return `${short}'s turn`;
}

function rowBody(entries: readonly PhaseEntry[]): string {
  if (entries.length === 0) return "You will not stop on this turn.";
  return `You will stop at ${phaseList(entries)}.`;
}

export function PhaseStopRowsDiagram({
  players,
  activePlayerId,
  step,
  turnColor,
}: PhaseStopDiagramProps) {
  const { appTheme, gameTheme } = useTheme();
  const view: DiagramView = {
    y: 0,
    width: WIDTH,
    height: tileY(players.length - 1) + TILE_HEIGHT + BOTTOM_PAD,
  };
  const surface = gameTheme.phaseStrip.background;
  const dark = gameTheme.canvas.shadow;
  const light = gameTheme.textOnTinted;
  const ink = readableTextColor(surface, dark, light);

  return (
    <div className="relative">
      <svg className="block h-auto w-full" viewBox={viewBox(view)} aria-hidden>
        <text x={WIDTH / 2} y={40} textAnchor="middle" className={STOP_DIAGRAM_TITLE}>
          Filled tile: you will stop at this step.
        </text>
        <text x={WIDTH / 2} y={76} textAnchor="middle" className={STOP_DIAGRAM_TEXT}>
          Each row is one player's turn.
        </text>
        {players.map((player, row) => {
          const top = tileY(row);
          const railY = top - RAIL_OFFSET;
          const playerInk = readableTextColor(player.color, dark, light);
          const entries = PHASE_BAR_ENTRIES.filter((entry) => hasStop(entry, player));
          return (
            <g key={player.id}>
              <circle cx={DOT_X} cy={top - NAME_OFFSET} r={6} fill={player.color} />
              <text
                x={NAME_X}
                y={top - NAME_OFFSET}
                dominantBaseline="central"
                className={STOP_DIAGRAM_TILE_LABEL}
                fill={ink}
              >
                {player.name}
              </text>
              {PHASE_BAR_ENTRIES.map((entry, index) => {
                const enabled = hasStop(entry, player);
                const current = player.id === activePlayerId && entry.steps.includes(step);
                return (
                  <g key={entry.id}>
                    <rect
                      x={tileX(index)}
                      y={top}
                      width={TILE_WIDTH}
                      height={TILE_HEIGHT}
                      rx={8}
                      fill={enabled ? player.color : surface}
                      stroke={current ? turnColor : "none"}
                      strokeWidth={3}
                    />
                    <text
                      x={tileX(index) + TILE_WIDTH / 2}
                      y={top + TILE_HEIGHT / 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      className={STOP_DIAGRAM_TILE_LABEL}
                      fill={enabled ? playerInk : ink}
                    >
                      {entry.short}
                    </text>
                  </g>
                );
              })}
              <PhaseStopArrows
                arrows={entries.map((entry) => ({
                  key: entry.id,
                  x: tileX(PHASE_BAR_ENTRIES.indexOf(entry)) + TILE_WIDTH / 2,
                  color: player.color,
                }))}
                railY={railY}
                tipY={top - TIP_OFFSET}
                railEnd={RAIL_END}
                mixedRailColor={appTheme["muted-foreground"]}
              />
              <text x={LABEL_X} y={railY + 10} className={STOP_DIAGRAM_TITLE}>
                {rowTitle(player.name, row === 0)}
              </text>
              <text x={LABEL_X} y={railY + 46} className={STOP_DIAGRAM_TEXT}>
                {rowBody(entries)}
              </text>
            </g>
          );
        })}
      </svg>
      {players.map((player, row) =>
        PHASE_BAR_ENTRIES.map((entry, index) => {
          const enabled = hasStop(entry, player);
          const style = {
            ...overlayBox(view, tileX(index), tileY(row), TILE_WIDTH, TILE_HEIGHT),
            "--seat": player.color,
          } as CSSProperties;
          return (
            <button
              key={`${player.id}:${entry.id}`}
              type="button"
              aria-label={`${player.name}: ${entry.label}, stop`}
              aria-pressed={enabled}
              className={cn(
                STOP_DIAGRAM_TARGET,
                "border-2 border-transparent hover:border-[var(--seat)]",
              )}
              style={style}
              onClick={() => togglePhaseStops(entry.steps, player.stops, player.toggle)}
            />
          );
        }),
      )}
    </div>
  );
}
