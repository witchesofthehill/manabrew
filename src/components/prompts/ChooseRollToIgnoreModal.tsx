import { Modal } from "@/components/game/modals/Modal";
import { useTheme } from "@/hooks/useTheme";
import { CardImageThumbnail } from "@/components/game/CardImageThumbnail";
import { MODAL_CARD_THUMBNAIL } from "@/components/game/game.styles";
import { DieFaceStatic } from "@/components/game/dice/DieFaceStatic";
import { usePromptSourceCard } from "./internal/usePromptSourceCard";
import type { PromptProps } from "./internal/promptProps";
import type { ChooseRollToIgnoreInput, ChooseRollToIgnoreOutput } from "@/protocol";

/**
 * Pick one die from the rolled set to drop. Click any die to commit.
 */
export function ChooseRollToIgnoreModal({
  input,
  respond,
}: PromptProps<ChooseRollToIgnoreInput, ChooseRollToIgnoreOutput>) {
  const sourceCard = usePromptSourceCard();
  const accentColor = useTheme().gameTheme.playerColors.self;

  return (
    <Modal maxWidth="max-w-sm" maxHeight="">
      <div role="dialog" aria-modal="true" aria-labelledby="choose-roll-ignore-title">
        <Modal.Header>
          <div className="flex items-center gap-3">
            {sourceCard && (
              <CardImageThumbnail card={sourceCard} className={MODAL_CARD_THUMBNAIL} />
            )}
            <div>
              <h2 id="choose-roll-ignore-title" className="font-semibold text-base">
                Choose a roll to ignore
              </h2>
              <p className="text-xs text-muted-foreground font-medium">{sourceCard?.name}</p>
            </div>
          </div>
        </Modal.Header>

        <Modal.Instructions>Click a die to drop it.</Modal.Instructions>

        <div className="p-4 flex flex-wrap gap-3 justify-center" role="group">
          {input.rolls.map((value, index) => (
            <DieFaceStatic
              key={`${value}-${index}`}
              sides={6}
              value={value}
              size="lg"
              accentColor={accentColor}
              onClick={() => respond({ type: "rollToIgnoreDecision", roll: value })}
              ariaLabel={`Ignore die ${value}`}
            />
          ))}
        </div>
      </div>
    </Modal>
  );
}
