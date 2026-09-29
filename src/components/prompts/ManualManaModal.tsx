import { Modal } from "@/components/game/modals/Modal";
import { Button } from "@/components/ui/button";
import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import { PromptPresentation } from "./internal/PromptPresentation";
import type { PromptProps } from "./internal/promptProps";
import type { PayManaCostInput, PayManaCostOutput } from "@/protocol";

export function ManualManaModal({
  input,
  respond,
  sourceCard,
}: PromptProps<PayManaCostInput, PayManaCostOutput>) {
  return (
    <Modal maxWidth="max-w-lg">
      <Modal.Header>
        <PromptPresentation presentation={input.presentation} sourceCard={sourceCard} />
      </Modal.Header>
      <Modal.Body>
        <div className="flex flex-col gap-2">
          {input.actions.map((action) => (
            <Button
              key={action.id}
              variant="outline"
              onClick={() => respond({ type: "act", actionId: action.id })}
            >
              <DynamicTextRender
                text={
                  action.type === "spendMana"
                    ? `Spend {${action.color}}`
                    : action.type === "unclassified"
                      ? action.label
                      : "description" in action
                        ? action.description
                        : action.type === "payLife"
                          ? `Pay ${action.amount} life`
                          : "Pay cost"
                }
              />
            </Button>
          ))}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline" onClick={() => respond({ type: "cancel" })}>
          Cancel
        </Button>
        {input.canConfirmFromPool && (
          <Button onClick={() => respond({ type: "pay", auto: false })}>Confirm</Button>
        )}
      </Modal.Footer>
    </Modal>
  );
}
