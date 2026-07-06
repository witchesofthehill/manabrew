import { Modal } from "./Modal";
import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import { CardImageThumbnail } from "@/components/game/CardImageThumbnail";
import { cn } from "@/lib/utils";
import type { HandActionOption } from "@/stores/useGameUIStore";
import { MODAL_CARD_THUMBNAIL } from "../game.styles";
import type { DeckCard } from "@/protocol/deck";

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
    <Modal maxWidth="max-w-md" maxHeight="" onClose={onCancel}>
      <Modal.Header>
        <div className="flex items-center gap-3">
          <CardImageThumbnail card={sourceCard} className={MODAL_CARD_THUMBNAIL} />
          <div>
            <h2 className="font-semibold text-base">
              {hasCastOption ? "Choose Action" : "Activate Ability"}
            </h2>
            <p className="text-xs text-muted-foreground font-medium">{sourceCard.identity.name}</p>
          </div>
        </div>
      </Modal.Header>

      <Modal.Instructions>Click an option to continue.</Modal.Instructions>

      <div
        className="p-4 flex flex-col gap-2 max-h-[60dvh] overflow-y-auto"
        role="group"
        aria-label="Available abilities"
      >
        {abilities.map((ability, idx) => (
          <button
            key={idx}
            onClick={() => onSelect(ability)}
            className={cn(
              "w-full text-left px-4 py-3 rounded-lg border text-sm font-medium transition-all",
              "hover:border-primary/50 hover:bg-muted/50 border-border bg-background",
            )}
          >
            <DynamicTextRender text={ability.label} />
          </button>
        ))}
      </div>
    </Modal>
  );
}
