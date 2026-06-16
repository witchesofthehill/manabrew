import { useState } from "react";
import { Modal } from "@/components/game/modals/Modal";
import { Button } from "@/components/ui/button";
import { CardImageThumbnail } from "@/components/game/CardImageThumbnail";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { MODAL_CARD_IMAGE } from "@/components/game/game.styles";
import { useModalKeyboard } from "@/hooks/useModalKeyboard";
import { usePromptSourceCard } from "./internal/usePromptSourceCard";
import type { PromptProps } from "./internal/promptProps";
import type { ChooseReplicateInput, ChooseReplicateOutput } from "@/protocol";

export function ReplicateModal({
  input,
  respond,
}: PromptProps<ChooseReplicateInput, ChooseReplicateOutput>) {
  const sourceCard = usePromptSourceCard();
  const [count, setCount] = useState(0);
  const decide = (replicateCount: number) => respond({ type: "replicateDecision", replicateCount });

  useModalKeyboard({ onSpace: count > 0 ? () => decide(count) : undefined }, [count, respond]);

  return (
    <Modal maxWidth="max-w-md" maxHeight="">
      <Modal.Header>
        <h2 className="font-semibold text-base">Replicate</h2>
      </Modal.Header>
      <div className="px-4 py-4 flex gap-3">
        {sourceCard && <CardImageThumbnail card={sourceCard} className={MODAL_CARD_IMAGE} />}
        <div className="self-center flex-1">
          <p className="text-sm text-muted-foreground mb-3">
            Pay <ManaSymbols cost={input.cost} size="lg" /> per copy (max {input.maxReplicates})
          </p>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={count <= 0}
              onClick={() => setCount((c) => Math.max(0, c - 1))}
            >
              -
            </Button>
            <span className="text-xl font-bold w-8 text-center">{count}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={count >= input.maxReplicates}
              onClick={() => setCount((c) => Math.min(input.maxReplicates, c + 1))}
            >
              +
            </Button>
          </div>
        </div>
      </div>
      <Modal.Footer>
        <Button variant="outline" onClick={() => decide(0)}>
          Skip
        </Button>
        <Button onClick={() => decide(count)}>Confirm ({count}x)</Button>
      </Modal.Footer>
    </Modal>
  );
}
