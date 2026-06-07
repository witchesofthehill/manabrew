import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/game/modals/Modal";
import { useTheme } from "@/hooks/useTheme";
import { CardImageThumbnail } from "@/components/game/CardImageThumbnail";
import { MODAL_CARD_THUMBNAIL } from "@/components/game/game.styles";
import { DiceRollAnimation } from "./DiceRollAnimation";
import { resolvePlayerColor, type PlayerSeatInfo } from "./playerColor";
import type { DiceRollSpec } from "./types";
import type { DeckCard } from "@/types/manabrew";

interface DiceRollFeedbackProps {
  sides: number;
  naturalResults: number[];
  finalResults: number[];
  ignoredRolls?: number[];
  /** Player slot id, e.g. "player-0". */
  playerId?: string;
  /** Players from the current game view; used to assign self/opponent colors. */
  players: PlayerSeatInfo[];
  sourceCard?: DeckCard;
  onAcknowledge: () => void;
}

/**
 * Display-only modal shown when the engine emits a `DiceRolled` notification.
 * Plays the animation and waits for the player to click Continue.
 */
export function DiceRollFeedback({
  sides,
  naturalResults,
  finalResults,
  ignoredRolls,
  playerId,
  players,
  sourceCard,
  onAcknowledge,
}: DiceRollFeedbackProps) {
  const themeColors = useTheme().gameTheme;
  const accentColor = resolvePlayerColor(playerId, players, themeColors.playerColors);

  const spec = useMemo<DiceRollSpec>(
    () => ({ sides, naturalResults, finalResults, ignoredRolls }),
    [sides, naturalResults, finalResults, ignoredRolls],
  );

  const summary = finalResults.join(", ");

  return (
    <Modal maxWidth="max-w-md" maxHeight="">
      <div role="dialog" aria-modal="true" aria-labelledby="dice-roll-title">
        <Modal.Header>
          <div className="flex items-center gap-3">
            {sourceCard && (
              <CardImageThumbnail card={sourceCard} className={MODAL_CARD_THUMBNAIL} />
            )}
            <div>
              <h2 id="dice-roll-title" className="font-semibold text-base">
                Rolled {summary} (d{sides})
              </h2>
              <p className="text-xs text-muted-foreground font-medium">{sourceCard?.name}</p>
            </div>
          </div>
        </Modal.Header>

        <div className="px-4 py-6">
          <DiceRollAnimation spec={spec} accentColor={accentColor} />
        </div>

        {ignoredRolls && ignoredRolls.length > 0 && (
          <div className="px-4 pb-3 text-xs text-muted-foreground text-center">
            Ignored: {ignoredRolls.join(", ")}
          </div>
        )}

        <Modal.Footer>
          <Button size="sm" onClick={onAcknowledge}>
            Continue
          </Button>
        </Modal.Footer>
      </div>
    </Modal>
  );
}
