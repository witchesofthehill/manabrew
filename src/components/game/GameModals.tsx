import { PromptModalHost } from "@/components/prompts/promptComponents";
import { GameOverlays } from "@/components/game/GameOverlays";
import type { CardDto, StackObjectDto } from "@/protocol/game";
import type { DeckCard } from "@/protocol/deck";
import type { Prompt } from "@/protocol";
import type { AbilityPickerState, HandActionOption } from "@/stores/useGameUIStore";

interface GameModalsProps {
  currentPrompt: Prompt | null;
  sourceDeckCard?: DeckCard;
  viewingZone: {
    title: string;
    cards: CardDto[];
    onClickCard?: (cardId: string) => void;
    clickableCardIds?: string[];
    targetHostile?: boolean;
  } | null;
  onCloseZone: () => void;
  spellStackModalOpen: boolean;
  stack: StackObjectDto[];
  validSpellIds: string[];
  onTargetSpell: (spellId: string) => void;
  onCloseStack: () => void;
  playerColorMap?: Map<string, string>;
  abilityPickerState: AbilityPickerState | null;
  onSelectAbility: (ability: HandActionOption) => void;
  onCancelAbilityPicker: () => void;
}

export function GameModals({
  currentPrompt,
  sourceDeckCard,
  viewingZone,
  onCloseZone,
  spellStackModalOpen,
  stack,
  validSpellIds,
  onTargetSpell,
  onCloseStack,
  playerColorMap,
  abilityPickerState,
  onSelectAbility,
  onCancelAbilityPicker,
}: GameModalsProps) {
  return (
    <>
      <PromptModalHost currentPrompt={currentPrompt} ctx={{ sourceDeckCard }} />
      <GameOverlays
        viewingZone={viewingZone}
        onCloseZone={onCloseZone}
        spellStackModalOpen={spellStackModalOpen}
        stack={stack}
        validSpellIds={validSpellIds}
        onTargetSpell={onTargetSpell}
        onCloseStack={onCloseStack}
        playerColorMap={playerColorMap}
        abilityPickerState={abilityPickerState}
        onSelectAbility={onSelectAbility}
        onCancelAbilityPicker={onCancelAbilityPicker}
      />
    </>
  );
}
