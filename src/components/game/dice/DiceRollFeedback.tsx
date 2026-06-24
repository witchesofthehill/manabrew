import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/game/modals/Modal";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { CardImageThumbnail } from "@/components/game/CardImageThumbnail";
import { MODAL_CARD_THUMBNAIL } from "@/components/game/game.styles";
import { DiceRollAnimation } from "./DiceRollAnimation";
import { DieFaceStatic } from "./DieFaceStatic";
import { buildPlayerColorMap, resolvePlayerColor, type PlayerSeatInfo } from "./playerColor";
import type { DiceRollSpec } from "./types";
import type { DiceRollEntry } from "@/protocol";
import type { DeckCard } from "@/protocol/deck";

/** Must match the `--animate-dice-roll` duration in `src/index.css`. */
const ANIMATION_DURATION_MS = 2000;

interface DiceRollFeedbackProps {
  sides: number;
  rolls: DiceRollEntry[];
  title?: string;
  /** Players from the current game view; used to assign self/opponent colors. */
  players: PlayerSeatInfo[];
  sourceCard?: DeckCard;
  onAcknowledge: () => void;
}

export function DiceRollFeedback({
  sides,
  rolls,
  title,
  players,
  sourceCard,
  onAcknowledge,
}: DiceRollFeedbackProps) {
  const labeled = rolls.length > 1 || rolls.some((r) => r.label != null || r.highlighted);

  return (
    <Modal maxWidth="max-w-md" maxHeight="">
      <div role="dialog" aria-modal="true" aria-labelledby="dice-roll-title">
        {labeled ? (
          <LabeledRolls sides={sides} rolls={rolls} title={title} players={players} />
        ) : (
          <SingleRoll sides={sides} roll={rolls[0]} players={players} sourceCard={sourceCard} />
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

function SingleRoll({
  sides,
  roll,
  players,
  sourceCard,
}: {
  sides: number;
  roll?: DiceRollEntry;
  players: PlayerSeatInfo[];
  sourceCard?: DeckCard;
}) {
  const themeColors = useTheme().gameTheme;
  const accentColor = resolvePlayerColor(
    roll?.playerId ?? undefined,
    players,
    themeColors.playerColors,
  );

  const spec = useMemo<DiceRollSpec>(
    () => ({
      sides,
      naturalResults: roll?.naturalResults ?? [],
      finalResults: roll?.finalResults ?? [],
      ignoredRolls: roll?.ignoredRolls ?? [],
    }),
    [sides, roll],
  );
  const finalResults = roll?.finalResults ?? [];
  const ignoredRolls = roll?.ignoredRolls ?? [];
  const summary = finalResults.join(", ");

  return (
    <>
      <Modal.Header>
        <div className="flex items-center gap-3">
          {sourceCard && <CardImageThumbnail card={sourceCard} className={MODAL_CARD_THUMBNAIL} />}
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

      {ignoredRolls.length > 0 && (
        <div className="px-4 pb-3 text-xs text-muted-foreground text-center">
          Ignored: {ignoredRolls.join(", ")}
        </div>
      )}
    </>
  );
}

interface DieAnimationParams {
  spinDeg: number;
  delayMs: number;
}

function LabeledRolls({
  sides,
  rolls,
  title,
  players,
}: {
  sides: number;
  rolls: DiceRollEntry[];
  title?: string;
  players: PlayerSeatInfo[];
}) {
  const themeColors = useTheme().gameTheme;
  const colorByPlayerId = useMemo(
    () => buildPlayerColorMap(players, themeColors.playerColors),
    [players, themeColors.playerColors],
  );
  // Stable randomized motion per die (lazy init so re-renders don't re-roll).
  const [params] = useState<DieAnimationParams[]>(() =>
    Array.from({ length: rolls.length }, generateParams),
  );
  const winner = rolls.find((r) => r.highlighted);

  return (
    <>
      <Modal.Header>
        <div>
          <h2 id="dice-roll-title" className="font-semibold text-base">
            {title ?? "Dice roll"}
          </h2>
          <p className="text-xs text-muted-foreground">Highest d{sides} goes first</p>
        </div>
      </Modal.Header>

      <div className="px-4 py-6 flex items-end justify-center gap-6 flex-wrap">
        {rolls.map((roll, index) => {
          const accent = roll.playerId ? colorByPlayerId.get(roll.playerId) : undefined;
          const value = roll.finalResults[0] ?? 0;
          return (
            <div key={roll.playerId ?? index} className="flex flex-col items-center gap-2">
              <span
                className="text-xs font-medium uppercase tracking-wide"
                style={accent ? { color: accent } : undefined}
              >
                {roll.label}
              </span>
              <div
                className="animate-dice-roll"
                style={
                  {
                    animationDelay: `${params[index]?.delayMs ?? 0}ms`,
                    ["--dice-spin" as string]: `${params[index]?.spinDeg ?? 540}deg`,
                  } as React.CSSProperties
                }
              >
                <DieFaceStatic
                  sides={sides}
                  value={value}
                  size="lg"
                  accentColor={accent}
                  ariaLabel={`${roll.label} rolled ${value}`}
                />
              </div>
            </div>
          );
        })}
      </div>

      {winner && (
        <div
          className={cn(
            "px-4 pb-4 text-sm font-semibold text-center",
            "animate-in fade-in duration-300",
          )}
          style={{ animationDelay: `${ANIMATION_DURATION_MS}ms`, animationFillMode: "both" }}
        >
          <span className="text-muted-foreground">First player: </span>
          <span
            style={{ color: winner.playerId ? colorByPlayerId.get(winner.playerId) : undefined }}
          >
            {winner.label}
          </span>
        </div>
      )}
    </>
  );
}

function generateParams(): DieAnimationParams {
  const turns = 2 + Math.random();
  const sign = Math.random() < 0.5 ? -1 : 1;
  return {
    spinDeg: Math.round(turns * 360 * sign),
    delayMs: Math.floor(Math.random() * 80),
  };
}
