import { Modal } from "@/components/game/modals/Modal";
import { Button } from "@/components/ui/button";
import { CardImageThumbnail } from "@/components/game/CardImageThumbnail";
import { TextWithMana } from "@/components/game/TextWithMana";
import { MODAL_CARD_IMAGE } from "@/components/game/game.styles";
import { usePromptSourceCard } from "./internal/usePromptSourceCard";
import type { PromptProps } from "./internal/promptProps";
import type { ChooseAlternativeCostInput, ChooseAlternativeCostOutput } from "@/protocol";

export function AlternativeCostModal({
  input,
  respond,
}: PromptProps<ChooseAlternativeCostInput, ChooseAlternativeCostOutput>) {
  const sourceCard = usePromptSourceCard();
  return (
    <Modal maxWidth="max-w-md" maxHeight="">
      <Modal.Header>
        <h2 className="font-semibold text-base">Choose Casting Option</h2>
      </Modal.Header>
      <div className="px-4 py-4 flex gap-3">
        {sourceCard && <CardImageThumbnail card={sourceCard} className={MODAL_CARD_IMAGE} />}
        <div className="flex flex-col gap-2 flex-1">
          {input.options.map((opt, idx) => (
            <Button
              key={idx}
              variant={idx === 0 ? "outline" : "default"}
              className="text-left justify-start h-auto py-2"
              onClick={() => respond({ type: "alternativeCostDecision", chosenIndex: idx })}
            >
              <TextWithMana text={opt} manaSize="sm" />
            </Button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
