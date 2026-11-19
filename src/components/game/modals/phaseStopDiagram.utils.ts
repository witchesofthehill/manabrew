import type { CSSProperties } from "react";
import { PHASE_BAR_ENTRIES } from "@/components/game/game.constants";
import type { StepKind } from "@/protocol";

export type PhaseEntry = (typeof PHASE_BAR_ENTRIES)[number];

export interface PhaseStopPlayer {
  id: string;
  name: string;
  color: string;
  stops: ReadonlySet<string>;
  toggle: (step: string) => void;
}

export interface PhaseStopDiagramProps {
  players: readonly PhaseStopPlayer[];
  activePlayerId: string;
  step: StepKind;
  turnColor: string;
}

export interface DiagramView {
  y: number;
  width: number;
  height: number;
}

export const STOP_DIAGRAM_TEXT = "font-game text-[25px] font-medium fill-muted-foreground";
export const STOP_DIAGRAM_TITLE = "font-game text-[30px] font-bold fill-foreground";
export const STOP_DIAGRAM_TILE_LABEL = "font-game text-[25px] font-bold";
export const STOP_DIAGRAM_TARGET =
  "absolute cursor-pointer rounded-md focus-visible:ring-2 focus-visible:ring-ring";

export function hasStop(entry: PhaseEntry, player: PhaseStopPlayer): boolean {
  return entry.steps.some((step) => player.stops.has(step));
}

export function viewBox({ y, width, height }: DiagramView): string {
  return `0 ${y} ${width} ${height}`;
}

export function overlayBox(
  view: DiagramView,
  x: number,
  y: number,
  width: number,
  height: number,
): CSSProperties {
  return {
    left: `${(x / view.width) * 100}%`,
    top: `${((y - view.y) / view.height) * 100}%`,
    width: `${(width / view.width) * 100}%`,
    height: `${(height / view.height) * 100}%`,
  };
}

function joinLabels(labels: readonly string[]): string {
  if (labels.length < 2) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

export function phaseList(entries: readonly PhaseEntry[]): string {
  if (entries.length === PHASE_BAR_ENTRIES.length) return "all steps";
  if (entries.length < 5) return joinLabels(entries.map((entry) => entry.short));
  const others = PHASE_BAR_ENTRIES.filter((entry) => !entries.includes(entry));
  return `all steps except ${joinLabels(others.map((entry) => entry.short))}`;
}
