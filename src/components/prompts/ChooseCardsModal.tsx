import { useMemo, useState } from "react";

import { Modal } from "@/components/game/modals/Modal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/game/Card";
import { stackObjectToCardStub } from "@/components/game/game.utils";
import { useGameStore } from "@/stores/useGameStore";
import { cn } from "@/lib/utils";
import { PromptPresentation } from "./internal/PromptPresentation";
import type { PromptProps } from "./internal/promptProps";
import type { GameCard } from "@/types/manabrew";
import type { ChooseCardsInput, ChooseCardsOutput } from "@/protocol";

function SelectableCard({
  card,
  selected,
  disabled,
  onClick,
}: {
  card: GameCard;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={disabled ? undefined : onClick}
      className={cn(
        "w-[150px] shrink-0 rounded transition-all",
        disabled ? "cursor-not-allowed opacity-30" : "cursor-pointer",
        selected && "ring-2 ring-primary",
      )}
    >
      <Card card={card} className="w-full" />
    </div>
  );
}

export function ChooseCardsModal({
  input,
  respond,
}: PromptProps<ChooseCardsInput, ChooseCardsOutput>) {
  const { presentation, min, max } = input;
  const cards = input.cards as GameCard[];
  const gameView = useGameStore((s) => s.gameView);
  const sourceCard = useMemo<GameCard | undefined>(() => {
    const id = presentation.sourceCardId;
    if (!id || !gameView) return undefined;
    const visible = [
      ...gameView.battlefield,
      ...gameView.players.flatMap((p) => [...p.hand, ...p.graveyard, ...p.exile, ...p.commandZone]),
    ];
    const gc = visible.find((c) => c.id === id);
    if (gc) return gc;
    const stackObj = gameView.stack.find((s) => s.sourceId === id);
    return stackObj ? (stackObjectToCardStub(stackObj) as GameCard) : undefined;
  }, [presentation.sourceCardId, gameView]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const chosen = [...selected];
  const canConfirm = chosen.length >= min && chosen.length <= max;
  const atMax = selected.size >= max;

  return (
    <Modal maxWidth="max-w-3xl" maxHeight="">
      {sourceCard && (
        <div className="pointer-events-none absolute top-0 right-full mr-6 drop-shadow-2xl">
          <Card card={sourceCard} bare className="w-[240px]" />
        </div>
      )}
      <div className="p-5">
        <PromptPresentation
          presentation={{ ...presentation, sourceCardId: undefined }}
          forceHorizontal
        />
      </div>

      <div className="always-scrollbar scrollbar-inset-x mb-4 flex flex-nowrap gap-3 overflow-x-auto px-5 pt-2 pb-4">
        {cards.map((c) => (
          <SelectableCard
            key={c.id}
            card={c}
            selected={selected.has(c.id)}
            disabled={atMax && !selected.has(c.id)}
            onClick={() =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(c.id)) next.delete(c.id);
                else next.add(c.id);
                return next;
              })
            }
          />
        ))}
      </div>

      <Modal.Footer className="justify-end gap-3">
        <span className="text-sm tabular-nums text-muted-foreground">
          {chosen.length}/{max}
        </span>
        <Button
          size="sm"
          disabled={!canConfirm}
          onClick={() => respond({ type: "chooseCardsDecision", chosenCardIds: chosen })}
        >
          {chosen.length === 0 && min === 0 ? "Skip" : "Confirm"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
