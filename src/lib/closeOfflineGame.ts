import { reportOfflineGame } from "@/lib/offlinePlayRecord";
import { offlineSeats } from "@/lib/offlineSeats";
import type { GameState } from "@/stores/gameStore.types";

export function closeOfflineGame(
  state: Pick<
    GameState,
    "isGameActive" | "isSpectator" | "isMultiplayer" | "gameView" | "currentPrompt" | "engineCrash"
  >,
  localRelayGame: boolean,
): void {
  if (!state.isGameActive || state.isSpectator) return;
  if (state.isMultiplayer && !localRelayGame) return;
  const seats = offlineSeats(state.gameView);
  const winnerId = state.gameView?.winnerId ?? null;
  reportOfflineGame({
    gameOver: (state.gameView?.gameOver ?? false) || state.currentPrompt?.input.type === "gameOver",
    winner: seats.find((seat) => seat.seatId === winnerId)?.username ?? null,
    seats,
    engineError: state.engineCrash,
  });
}
