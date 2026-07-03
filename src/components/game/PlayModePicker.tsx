import { Button } from "@/components/ui/button";
import { Modal } from "@/components/game/modals/Modal";
import { CardImageThumbnail } from "@/components/game/CardImageThumbnail";
import { MODAL_CARD_THUMBNAIL } from "./game.styles";
import type { DeckCard } from "@/protocol/deck";

interface PlayModeOption {
  cardId: string;
  mode: string;
  modeLabel: string;
}

interface PlayModePickerProps {
  card: DeckCard;
  options: PlayModeOption[];
  onSelect: (mode: string) => void;
  onCancel: () => void;
}

export function PlayModePicker({ card, options, onSelect, onCancel }: PlayModePickerProps) {
  return (
    <Modal maxWidth="max-w-sm" maxHeight="">
      <Modal.Header>
        <div className="flex items-center gap-3">
          <CardImageThumbnail card={card} className={MODAL_CARD_THUMBNAIL} />
          <div>
            <h2 className="font-semibold text-base">Choose how to cast</h2>
            <p className="text-xs text-muted-foreground font-medium">{card.identity.name}</p>
          </div>
        </div>
      </Modal.Header>

      <div className="p-4 flex flex-col gap-2">
        {options.map((opt) => (
          <Button
            key={opt.mode}
            variant="outline"
            className="w-full justify-start text-sm"
            onClick={() => onSelect(opt.mode)}
          >
            {opt.modeLabel}
          </Button>
        ))}
      </div>

      <div className="px-4 pb-4">
        <Button size="sm" variant="ghost" onClick={onCancel} className="w-full">
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
