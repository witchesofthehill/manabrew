import { Modal } from "@/components/game/modals/Modal";
import { Button } from "@/components/ui/button";
import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import type { PromptProps } from "./internal/promptProps";
import type { ChooseActionInput, ChooseActionOutput, GameViewDto } from "@/protocol";

export function AvailableActionsModal({
  input,
  respond,
  gameView,
}: PromptProps<ChooseActionInput, ChooseActionOutput> & { gameView?: GameViewDto | null }) {
  const cards = gameView?.zones.flatMap((zone) => zone.cards) ?? [];
  return (
    <Modal maxWidth="max-w-lg">
      <Modal.Header>Available actions</Modal.Header>
      <Modal.Body>
        <div className="flex flex-col gap-2">
          {input.actions.map((action) => {
            const card = cards.find((card) => card.id === action.cardId);
            const name = card?.visibility === "visible" ? card.identity.name : "Card";
            const label =
              "label" in action
                ? action.label
                : action.type === "activateAbility"
                  ? action.description
                  : "Undo mana";
            return (
              <Button
                key={action.id}
                variant="outline"
                onClick={() => respond({ type: "act", actionId: action.id })}
              >
                <DynamicTextRender text={`${name}: ${label}`} />
              </Button>
            );
          })}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button onClick={() => respond({ type: "pass", exhaustStack: false })}>
          Pass priority
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
