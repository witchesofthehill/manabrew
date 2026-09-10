import { Button } from "@/components/ui/button";
import { Modal } from "@/components/game/modals/Modal";
import { CardImageThumbnail } from "@/components/game/CardImageThumbnail";
import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import { MODAL_CARD_THUMBNAIL } from "./game.styles";
import type { DeckCard } from "@/protocol/deck";
import type { HandActionOption } from "@/stores/useGameUIStore";
import { Trans } from "@lingui/react/macro";
import { useCard } from "@/stores/useScryfallStore";
import { localizeRulesPreviewText } from "@/pixi/cardPreview/rulesCardPreviewPresentation";
interface PlayModePickerProps {
  card: DeckCard;
  options: HandActionOption[];
  onSelect: (option: HandActionOption) => void;
  onCancel: () => void;
}
export function PlayModePicker({ card, options, onSelect, onCancel }: PlayModePickerProps) {
  const info = useCard({
    name: card.identity.name,
    setCode: card.identity.setCode,
    cardNumber: card.identity.cardNumber,
  })?.info;
  return (
    <Modal onClose={onCancel} maxWidth="max-w-sm" maxHeight="">
      <Modal.Header>
        <div className="flex items-center gap-3">
          <CardImageThumbnail card={card} className={MODAL_CARD_THUMBNAIL} />
          <div>
            <h2 className="font-semibold text-base">
              <Trans>Choose an action</Trans>
            </h2>
            <p className="text-xs text-muted-foreground font-medium">{card.identity.name}</p>
          </div>
        </div>
      </Modal.Header>

      <div className="p-4 flex flex-col gap-2">
        {options.map((opt, idx) => (
          <Button
            key={opt.actionId ?? `${opt.kind}-${idx}`}
            variant="outline"
            className="w-full justify-between gap-2 text-sm"
            onClick={() => onSelect(opt)}
          >
            <DynamicTextRender text={localizeRulesPreviewText(opt.label, info ?? null, 0)} />
            {opt.cost && <DynamicTextRender className="opacity-90" text={opt.cost} />}
          </Button>
        ))}
      </div>

      <div className="px-4 pb-4">
        <Button size="sm" variant="ghost" onClick={onCancel} className="w-full">
          <Trans>Cancel</Trans>
        </Button>
      </div>
    </Modal>
  );
}
