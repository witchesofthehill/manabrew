import { Modal } from "@/components/game/modals/Modal";
import { Button } from "@/components/ui/button";
import { useModalKeyboard } from "@/hooks/useModalKeyboard";
import { PromptPresentation } from "./internal/PromptPresentation";
import { isVerticalPresentation } from "./internal/promptLayout";
import type { PromptProps } from "./internal/promptProps";
import type { ChooseBooleanInput, ChooseBooleanOutput } from "@/protocol";

export function ChooseBooleanModal({
  input,
  respond,
}: PromptProps<ChooseBooleanInput, ChooseBooleanOutput>) {
  const decide = (value: boolean) => respond({ type: "decision", value });
  useModalKeyboard({ onSpace: () => decide(true) }, [respond]);

  const vertical = isVerticalPresentation(input.presentation);

  return (
    <Modal
      maxWidth={vertical ? "" : "max-w-2xl"}
      maxHeight=""
      className={vertical ? "w-auto max-w-[min(90vw,32rem)]" : undefined}
    >
      <div className="p-6">
        <PromptPresentation
          presentation={input.presentation}
          actions={
            <>
              <Button variant="outline" onClick={() => decide(false)}>
                {input.denyLabel}
              </Button>
              <Button onClick={() => decide(true)}>{input.confirmLabel}</Button>
            </>
          }
        />
      </div>
    </Modal>
  );
}
