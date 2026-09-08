import { Button } from "@/components/ui/button";
import { CardImageThumbnail } from "@/components/game/CardImageThumbnail";
import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import type { DeckCard } from "@/protocol/deck";
import type { HandActionOption } from "@/stores/useGameUIStore";
import { MODAL_CARD_THUMBNAIL } from "../game.styles";
import { Modal } from "./Modal";

interface ActionPickerModalProps {
  card: DeckCard;
  title: string;
  options: HandActionOption[];
  onSelect: (option: HandActionOption) => void;
  onCancel: () => void;
}

export function ActionPickerModal({
  card,
  title,
  options,
  onSelect,
  onCancel,
}: ActionPickerModalProps) {
  return (
    <Modal maxWidth="max-w-md" maxHeight="" onClose={onCancel}>
      <Modal.Header onClose={onCancel}>
        <div className="flex items-center gap-3">
          <CardImageThumbnail card={card} className={MODAL_CARD_THUMBNAIL} />
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="truncate text-xs font-medium text-muted-foreground">
              {card.identity.name}
            </p>
          </div>
        </div>
      </Modal.Header>

      <Modal.Instructions>Select an option to continue.</Modal.Instructions>

      <Modal.Body className="flex max-h-[60dvh] flex-col gap-2">
        <div role="group" aria-label="Available actions" className="flex flex-col gap-2">
          {options.map((option, index) => (
            <Button
              key={option.actionId ?? `${option.kind}-${index}`}
              variant="outline"
              className="h-auto min-h-12 w-full justify-between gap-4 px-4 py-3 text-left"
              onClick={() => onSelect(option)}
            >
              <DynamicTextRender className="min-w-0 flex-1" text={option.label} />
              {option.cost && (
                <span className="shrink-0 rounded-md bg-muted/60 px-2 py-1">
                  <DynamicTextRender text={option.cost} />
                </span>
              )}
            </Button>
          ))}
        </div>
      </Modal.Body>

      <Modal.Footer>
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

interface AbilityPickerModalProps {
  sourceCard: DeckCard;
  abilities: HandActionOption[];
  onSelect: (ability: HandActionOption) => void;
  onCancel: () => void;
}

export function AbilityPickerModal({
  sourceCard,
  abilities,
  onSelect,
  onCancel,
}: AbilityPickerModalProps) {
  const hasCastOption = abilities.some((ability) => ability.kind === "cast");
  return (
    <ActionPickerModal
      card={sourceCard}
      title={hasCastOption ? "Choose an action" : "Activate an ability"}
      options={abilities}
      onSelect={onSelect}
      onCancel={onCancel}
    />
  );
}
