import { Button } from "@/components/ui/button";
import { Modal } from "@/components/game/modals/Modal";
import { Card } from "@/components/game/Card";
import { useModalKeyboard } from "@/hooks/useModalKeyboard";
import type { PromptProps } from "./internal/promptProps";
import type { RevealCardsInput, RevealCardsOutput } from "@/protocol";
import type { GameCard } from "@/types/manabrew";

export function RevealCardsModal({
  input,
  respond,
}: PromptProps<RevealCardsInput, RevealCardsOutput>) {
  const confirm = () => respond({ type: "revealCardsAcknowledged" });
  useModalKeyboard({ onSpace: confirm }, [respond]);
  return (
    <Modal maxWidth="max-w-4xl" maxHeight="max-h-[85vh]">
      <Modal.Header>
        <h2 className="font-semibold text-base">Look At Cards</h2>
        <p className="text-xs text-muted-foreground">{input.message}</p>
      </Modal.Header>

      <div className="px-4 pb-4 flex-1 min-h-0 overflow-y-auto">
        <div className="flex flex-wrap gap-3 justify-center content-start">
          {(input.cards as GameCard[]).map((card) => (
            <div key={card.id} className="shrink-0">
              <Card card={card} />
            </div>
          ))}
        </div>
      </div>

      <Modal.Footer>
        <Button size="sm" onClick={confirm}>
          Continue
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
