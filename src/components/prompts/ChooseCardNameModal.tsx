import { useId, useState } from "react";
import { Modal } from "@/components/game/modals/Modal";
import { Button } from "@/components/ui/button";
import { MODAL_INPUT } from "@/components/game/game.styles";
import { useModalKeyboard } from "@/hooks/useModalKeyboard";
import { PromptPresentation } from "./internal/PromptPresentation";
import { useModalSourceCard } from "./internal/ModalSourceCard";
import type { PromptProps } from "./internal/promptProps";
import type { ChooseCardNameInput, ChooseCardNameOutput } from "@/protocol";

export function ChooseCardNameModal({
  input,
  respond,
  sourceCard,
}: PromptProps<ChooseCardNameInput, ChooseCardNameOutput>) {
  const { preview, presentation, inlineSourceCard } = useModalSourceCard(
    input.presentation,
    sourceCard,
  );
  const [name, setName] = useState("");
  const suggestionsId = useId();
  const trimmed = name.trim();
  const canonical = input.suggestions.find(
    (suggestion) => suggestion.toLowerCase() === trimmed.toLowerCase(),
  );
  const chosenName = canonical ?? trimmed;
  const confirm = () => {
    if (chosenName) respond({ type: "cardNameDecision", name: chosenName });
  };
  useModalKeyboard({ onEnter: chosenName ? confirm : undefined }, [chosenName]);

  return (
    <Modal maxWidth="max-w-md" maxHeight="">
      {preview}
      <div className="shrink-0 p-5 pb-2">
        <PromptPresentation presentation={presentation} sourceCard={inlineSourceCard} />
      </div>
      <Modal.Body className="space-y-2">
        <input
          autoFocus
          type="text"
          list={input.suggestions.length > 0 ? suggestionsId : undefined}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Type an exact card name"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className={MODAL_INPUT}
        />
        {input.suggestions.length > 0 && (
          <datalist id={suggestionsId}>
            {input.suggestions.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
        )}
        <p className="text-xs text-muted-foreground">Enter the full English card name.</p>
      </Modal.Body>
      <Modal.Footer>
        <Button disabled={!chosenName} onClick={confirm}>
          Confirm
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
