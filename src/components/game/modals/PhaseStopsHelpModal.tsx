import { opponentsInTurnOrder } from "@/components/game/game.utils";
import { useTheme } from "@/hooks/useTheme";
import { stripUsernameTag } from "@/lib/username";
import type { ClientGameView } from "@/stores/gameStore.types";
import { DEFAULT_OPPONENT_STOPS, usePhaseStopStore } from "@/stores/usePhaseStopStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { Modal } from "./Modal";
import { PhaseStopCompactDiagram } from "./PhaseStopCompactDiagram";
import { PhaseStopRowsDiagram } from "./PhaseStopRowsDiagram";
import type { PhaseStopPlayer } from "./phaseStopDiagram.utils";

interface PhaseStopsHelpModalProps {
  gameView: ClientGameView;
  localPlayerId: string;
  turnColor: string;
  onClose: () => void;
}

export function PhaseStopsHelpModal({
  gameView,
  localPlayerId,
  turnColor,
  onClose,
}: PhaseStopsHelpModalProps) {
  const { playerColors } = useTheme().gameTheme;
  const perPlayer = usePreferencesStore((state) => state.phaseStopLayout) === "per-player";
  const selfStops = usePhaseStopStore((state) => state.selfStops);
  const opponentStops = usePhaseStopStore((state) => state.opponentStops);
  const toggleSelfStop = usePhaseStopStore((state) => state.toggleSelfStop);
  const toggleOpponentStop = usePhaseStopStore((state) => state.toggleOpponentStop);
  const opponentColors = [playerColors.opponent1, playerColors.opponent2, playerColors.opponent3];
  const players: PhaseStopPlayer[] = [
    {
      id: localPlayerId,
      name: "You",
      color: playerColors.self,
      stops: selfStops,
      toggle: toggleSelfStop,
    },
    ...opponentsInTurnOrder(gameView.players, localPlayerId).map((player, index) => ({
      id: player.id,
      name: stripUsernameTag(player.name),
      color: opponentColors[index] ?? playerColors.opponent1,
      stops: opponentStops.get(player.id) ?? DEFAULT_OPPONENT_STOPS,
      toggle: (step: string) => toggleOpponentStop(player.id, step),
    })),
  ];
  const Diagram = perPlayer ? PhaseStopRowsDiagram : PhaseStopCompactDiagram;

  return (
    <Modal onClose={onClose} maxWidth={perPlayer ? "max-w-4xl" : "max-w-2xl"}>
      <Modal.Header onClose={onClose}>
        <h2 className="text-base font-semibold">Phase stops</h2>
        <p className="text-xs text-muted-foreground">
          {perPlayer
            ? "Select a tile to set or clear a stop. Changes apply immediately."
            : "Select above or below a tile to set or clear a stop. Changes apply immediately."}
        </p>
      </Modal.Header>
      <Modal.Body className="space-y-4">
        <Diagram
          players={players}
          activePlayerId={gameView.activePlayerId}
          step={gameView.step}
          turnColor={turnColor}
        />
        <p className="text-center text-ui-meta text-muted-foreground">
          You also stop at any step if a spell or ability is on the stack.
        </p>
      </Modal.Body>
      <Modal.Footer>
        <Modal.Close data-autofocus onClose={onClose} variant="ghost">
          Done
        </Modal.Close>
      </Modal.Footer>
    </Modal>
  );
}
