// SPDX-License-Identifier: GPL-3.0-or-later

import type { GameViewDto } from "@/protocol/game";

export interface GameSnapshotEntry {
  checkpointId: number;
  label: string;
  timestampMs: number;
  gameView: GameViewDto;
}

export function normalizeSnapshotPayload(payload: unknown): GameSnapshotEntry {
  const p = (payload ?? {}) as Partial<GameSnapshotEntry> & Record<string, unknown>;
  const checkpointId =
    typeof p.checkpointId === "number"
      ? p.checkpointId
      : typeof p.checkpoint_id === "number"
        ? (p.checkpoint_id as number)
        : 0;
  const label = typeof p.label === "string" ? p.label : `Checkpoint ${checkpointId}`;
  const timestampMs =
    typeof p.timestampMs === "number"
      ? p.timestampMs
      : typeof p.timestamp_ms === "number"
        ? (p.timestamp_ms as number)
        : Date.now();
  const gameView = (p.gameView ?? p.game_view ?? null) as GameViewDto | null;
  return {
    checkpointId,
    label,
    timestampMs,
    gameView: gameView as GameViewDto,
  };
}
