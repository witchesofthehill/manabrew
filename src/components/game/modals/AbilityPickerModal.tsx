import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import type { DeckCard } from "@/protocol/deck";
import type { CardDto } from "@/protocol/game";
import type { HandActionOption } from "@/stores/useGameUIStore";
import { deckCardToPreviewDto } from "@/lib/scryfall.utils";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { Modal } from "./Modal";
import { DialogCardInspector } from "./DialogCardInspector";
import type { CardInspectionState } from "./cardInspection";

export interface ActionPickerModalProps {
  card: DeckCard;
  sourceCard?: CardDto;
  title: string;
  options: HandActionOption[];
  pending?: boolean;
  error?: string;
  initialInspection?: CardInspectionState;
  onSelect: (option: HandActionOption) => void;
  onCancel: () => void;
}

export function ActionPickerModal({
  card,
  sourceCard,
  title,
  options,
  pending = false,
  error,
  initialInspection,
  onSelect,
  onCancel,
}: ActionPickerModalProps) {
  const source = useMemo(() => sourceCard ?? deckCardToPreviewDto(card), [sourceCard, card]);
  const defaultView = usePreferencesStore((s) => s.promptCardStyle);
  const [inspection, setInspection] = useState<CardInspectionState>(
    initialInspection ?? {
      rules: defaultView === "rules",
      face: source.isTransformed ? 1 : 0,
      rotated: false,
    },
  );
  const [highlight, setHighlight] = useState("");
  return (
    <Modal maxWidth="max-w-4xl" onClose={pending ? undefined : onCancel}>
      <Modal.Header onClose={pending ? undefined : onCancel}>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{source.identity.name}</p>
      </Modal.Header>
      <Modal.Body className="grid gap-4 md:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
        <DialogCardInspector
          card={source}
          state={inspection}
          onChange={setInspection}
          highlight={highlight}
        />
        <div className="min-w-0 space-y-3">
          <p className="text-sm text-muted-foreground">
            Inspect the card, then choose an available action. Viewing another face does not change
            the action you choose.
          </p>
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-destructive p-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <div
            role="group"
            aria-label="Available actions"
            className="flex flex-col gap-2"
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              const buttons = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
              ];
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              event.preventDefault();
              buttons[
                (index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length
              ]?.focus();
            }}
          >
            {options.map((option, index) => (
              <Button
                key={option.actionId ?? `${option.kind}-${index}`}
                variant="outline"
                disabled={pending}
                className="h-auto min-h-12 w-full justify-between gap-3 whitespace-normal px-4 py-3 text-left hover:border-card-ring focus-visible:ring-card-ring"
                onPointerEnter={() => setHighlight(option.kind === "ability" ? option.label : "")}
                onFocus={() => setHighlight(option.kind === "ability" ? option.label : "")}
                onClick={() => {
                  if (!pending) onSelect(option);
                }}
              >
                <DynamicTextRender
                  className="min-w-0 flex-1 whitespace-normal"
                  text={option.label}
                />
                {option.cost && (
                  <span className="shrink-0 rounded-md bg-muted/60 px-2 py-1">
                    <DynamicTextRender text={option.cost} />
                  </span>
                )}
              </Button>
            ))}
            {!options.length && (
              <p role="status" className="p-4 text-sm text-muted-foreground">
                No actions are currently available for this card.
              </p>
            )}
          </div>
          {pending && (
            <p role="status" className="text-sm text-muted-foreground">
              Waiting for the game to respond…
            </p>
          )}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Modal.Close onClose={onCancel} disabled={pending} variant="outline">
          Back
        </Modal.Close>
      </Modal.Footer>
    </Modal>
  );
}

interface AbilityPickerModalProps {
  sourceCard: DeckCard;
  liveCard?: CardDto;
  abilities: HandActionOption[];
  pending?: boolean;
  error?: string;
  onSelect: (ability: HandActionOption) => void;
  onCancel: () => void;
}
export function AbilityPickerModal({
  sourceCard,
  liveCard,
  abilities,
  pending,
  error,
  onSelect,
  onCancel,
}: AbilityPickerModalProps) {
  return (
    <ActionPickerModal
      card={sourceCard}
      sourceCard={liveCard}
      title={
        abilities.some((ability) => ability.kind === "cast")
          ? "Choose an action"
          : "Activate an ability"
      }
      options={abilities}
      pending={pending}
      error={error}
      onSelect={onSelect}
      onCancel={onCancel}
    />
  );
}
