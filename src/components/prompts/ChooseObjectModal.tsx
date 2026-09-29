import { Modal } from "@/components/game/modals/Modal";
import { Button } from "@/components/ui/button";
import { PromptPresentation } from "./internal/PromptPresentation";
import type { PromptProps } from "./internal/promptProps";
import type { ChooseObjectInput, ChooseObjectOutput, GameViewDto, TargetRef } from "@/protocol";

export function ChooseObjectModal({
  input,
  respond,
  sourceCard,
  gameView,
}: PromptProps<ChooseObjectInput, ChooseObjectOutput> & { gameView?: GameViewDto | null }) {
  const label = (target: TargetRef, index: number) => {
    if (target.kind === "player") {
      return (
        gameView?.players.find((player) => player.id === target.id)?.name ?? `Player ${index + 1}`
      );
    }
    const spell = gameView?.stack.find((card) => card.id === target.id);
    if (spell) return spell.identity.name;
    for (const zone of gameView?.zones ?? []) {
      const card = zone.cards.find((card) => card.id === target.id);
      if (card?.visibility === "visible") return card.identity.name;
    }
    return `Card ${index + 1}`;
  };
  return (
    <Modal maxWidth="max-w-lg">
      <Modal.Header>
        <PromptPresentation presentation={input.presentation} sourceCard={sourceCard} />
      </Modal.Header>
      <Modal.Body>
        <div className="flex flex-col gap-2">
          {input.candidates.map((target, index) => {
            const selected = input.selected.some(
              (item) => item.id === target.id && item.kind === target.kind,
            );
            return (
              <Button
                key={`${target.kind}:${target.id}`}
                variant={selected ? "default" : "outline"}
                aria-pressed={selected}
                onClick={() => respond({ type: "select", target })}
              >
                {label(target, index)}
                {selected ? " (selected)" : ""}
              </Button>
            );
          })}
        </div>
      </Modal.Body>
      <Modal.Footer>
        {input.cancellable && (
          <Button variant="outline" onClick={() => respond({ type: "cancel" })}>
            Cancel
          </Button>
        )}
        {input.canFinish && <Button onClick={() => respond({ type: "finish" })}>Done</Button>}
      </Modal.Footer>
    </Modal>
  );
}
