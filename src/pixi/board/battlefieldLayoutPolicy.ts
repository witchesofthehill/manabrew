import type { BoardLayout } from "./boardLayout";
import type { PlayZoneRect } from "../types";

export interface BattlefieldLayoutInput {
  width: number;
  height: number;
  opponentCount: number;
  requestedBottomReserve: number;
  opponentLayout: "focused" | "overview";
  observedHandReserve: number;
  cardSizeMultiplier: number;
  handViewportScale: number;
}

export interface BattlefieldLayoutResult {
  layout: BoardLayout;
  scales: { self: number; opponent: number };
  combatRowReserved: boolean;
  handScale: number;
  selfClusterMaxHeight: number;
}

export interface BattlefieldLayoutPolicy {
  compute(input: BattlefieldLayoutInput): BattlefieldLayoutResult;
  effectiveBottomReserve(requestedBottomReserve: number): number;
  clusterHeight(
    self: PlayZoneRect | null,
    observedHandReserve: number,
    requestedBottomReserve: number,
  ): number;
  showPhaseDivider: boolean;
}
