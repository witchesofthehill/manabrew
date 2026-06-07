import { Button } from "@/components/ui/button";
import { Modal } from "./Modal";
import { useEffect, useRef, useCallback } from "react";
import { useModalKeyboard } from "@/hooks/useModalKeyboard";
import { CardImageThumbnail } from "@/components/game/CardImageThumbnail";
import { Card } from "@/components/game/Card";
import { MODAL_CARD_IMAGE } from "../game.styles";
import type { DeckCard, GameCard } from "@/types/manabrew";
import { usePromptPreferencesStore } from "@/stores/usePromptPreferencesStore";

interface ChooseOptionalTriggerModalProps {
  /** Human-readable description of the triggered ability. */
  description: string;
  /** Optional cards to show as part of the prompt context. */
  cards?: GameCard[];
  sourceCard?: DeckCard;
  sourceCardId?: string;
  /** Prompt context (optional_trigger, confirm_action, confirm_payment, choose_binary). */
  promptKind?: string;
  /** Optional labels for [decline, accept] buttons. */
  optionLabels?: string[];
  /** Optional mode metadata for confirm_action prompts. */
  mode?: string;
  /** Optional API metadata for confirm_action prompts. */
  api?: string;
  onConfirm: (accept: boolean) => void;
}

export function ChooseOptionalTriggerModal({
  description,
  cards,
  sourceCard,
  sourceCardId,
  promptKind,
  optionLabels,
  mode,
  api,
  onConfirm,
}: ChooseOptionalTriggerModalProps) {
  const rememberTrigger = usePromptPreferencesStore((s) => s.rememberTrigger);
  const showMemory = !!sourceCardId && (!promptKind || promptKind === "optional_trigger");

  const handleAlwaysYes = useCallback(() => {
    if (sourceCardId) rememberTrigger(sourceCardId, "yes");
    onConfirm(true);
  }, [sourceCardId, rememberTrigger, onConfirm]);

  const handleAlwaysNo = useCallback(() => {
    if (sourceCardId) rememberTrigger(sourceCardId, "no");
    onConfirm(false);
  }, [sourceCardId, rememberTrigger, onConfirm]);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, [description]);

  const handleAccept = useCallback(() => onConfirm(true), [onConfirm]);
  const handleDecline = useCallback(() => onConfirm(false), [onConfirm]);
  const declineLabel = optionLabels?.[0] ?? "Decline";
  const acceptLabel = optionLabels?.[1] ?? "Accept";
  const isGenericConfirm = promptKind === "confirm_action";
  const isPaymentConfirm = promptKind === "confirm_payment";
  const isBinaryChoice = promptKind === "choose_binary";
  const title = isGenericConfirm
    ? "Confirm Action"
    : isPaymentConfirm
      ? "Confirm Payment"
      : isBinaryChoice
        ? "Choose One"
        : "Optional Trigger";
  const subtitle = isGenericConfirm
    ? "Confirm whether to apply this optional action."
    : isPaymentConfirm
      ? "Confirm whether to pay this cost."
      : isBinaryChoice
        ? "Choose one of the two options."
        : "Do you want this ability to trigger?";
  const metaBits = [mode, api].filter(Boolean).join(" • ");

  useModalKeyboard({ onEnter: handleAccept, onEscape: handleDecline }, [
    handleAccept,
    handleDecline,
  ]);

  return (
    <Modal maxWidth={cards && cards.length > 0 ? "max-w-4xl" : "max-w-md"} maxHeight="">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="optional-trigger-title"
      >
        <Modal.Header>
          <h2 id="optional-trigger-title" className="font-semibold text-base">
            {title}
          </h2>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
          {metaBits && <p className="text-[11px] text-muted-foreground">{metaBits}</p>}
        </Modal.Header>

        <div className="px-4 py-4 flex gap-3">
          {sourceCard && <CardImageThumbnail card={sourceCard} className={MODAL_CARD_IMAGE} />}
          <p className="text-sm leading-relaxed self-center">
            {description || "A triggered ability would trigger. Do you want it to?"}
          </p>
        </div>

        {cards && cards.length > 0 && (
          <div className="px-4 pb-4">
            <p className="text-xs text-muted-foreground mb-2">Look at these cards first:</p>
            <div className="flex flex-wrap gap-3 justify-center">
              {cards.map((card) => (
                <div key={card.id} className="shrink-0">
                  <Card card={card} />
                </div>
              ))}
            </div>
          </div>
        )}

        <Modal.Footer>
          {showMemory && (
            <div className="mr-auto flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleAlwaysNo}
                className="text-xs text-muted-foreground"
                title="Decline now and remember for the rest of this game"
              >
                Always no
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleAlwaysYes}
                className="text-xs text-muted-foreground"
                title="Accept now and remember for the rest of this game"
              >
                Always yes
              </Button>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={handleDecline} className="min-w-[80px]">
            {declineLabel}
          </Button>
          <Button size="sm" onClick={handleAccept} className="min-w-[80px]">
            {acceptLabel}
          </Button>
        </Modal.Footer>
      </div>
    </Modal>
  );
}
