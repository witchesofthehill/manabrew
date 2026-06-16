import { Modal } from "@/components/game/modals/Modal";
import { Button } from "@/components/ui/button";
import { CardImageThumbnail } from "@/components/game/CardImageThumbnail";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { MODAL_CARD_IMAGE } from "@/components/game/game.styles";
import { useModalKeyboard } from "@/hooks/useModalKeyboard";
import { usePromptSourceCard } from "./internal/usePromptSourceCard";
import type { PromptProps } from "./internal/promptProps";
import type { ChooseKickerInput, ChooseKickerOutput } from "@/protocol";

export function KickerModal({
  input,
  respond,
}: PromptProps<ChooseKickerInput, ChooseKickerOutput>) {
  const sourceCard = usePromptSourceCard();
  const decide = (kicked: boolean) => respond({ type: "kickerDecision", kicked });
  useModalKeyboard({ onSpace: () => decide(true) }, [respond]);
  return (
    <Modal maxWidth="max-w-md" maxHeight="">
      <Modal.Header>
        <h2 className="font-semibold text-base">Pay Kicker?</h2>
      </Modal.Header>
      <div className="px-4 py-4 flex gap-3">
        {sourceCard && <CardImageThumbnail card={sourceCard} className={MODAL_CARD_IMAGE} />}
        <p className="text-sm text-muted-foreground self-center">
          Pay additional kicker cost: <ManaSymbols cost={input.kickerCost} size="lg" />
        </p>
      </div>
      <Modal.Footer>
        <Button variant="outline" onClick={() => decide(false)}>
          No
        </Button>
        <Button onClick={() => decide(true)}>Pay Kicker</Button>
      </Modal.Footer>
    </Modal>
  );
}
