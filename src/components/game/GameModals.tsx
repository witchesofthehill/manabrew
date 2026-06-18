import { PromptModalHost } from "@/components/prompts/promptComponents";
// import { ChooseFromSelectionModalPreview } from "@/components/prompts/dev/ChooseFromSelectionModalPreview";
// import { ChooseBooleanModalPreview } from "@/components/prompts/dev/ChooseBooleanModalPreview";
import { GameOverlays } from "@/components/game/GameOverlays";
import type { LibraryPeekMode } from "@/components/prompts/LibraryPeekModal";
import type { DeckCard, GameCard, StackObject } from "@/types/manabrew";
import type { Prompt } from "@/protocol";
import type { AbilityPickerState, HandActionOption } from "@/stores/useGameUIStore";

interface GameModalsProps {
  currentPrompt: Prompt | null;
  sourceDeckCard?: DeckCard;
  revealedDeckCard?: DeckCard;
  viewingZone: {
    title: string;
    cards: GameCard[];
    onClickCard?: (cardId: string) => void;
    clickableCardIds?: string[];
    targetHostile?: boolean;
  } | null;
  onCloseZone: () => void;
  libraryPeekModal: {
    mode: LibraryPeekMode;
    cards: GameCard[];
    numToTake?: number;
    optional?: boolean;
  } | null;
  onLibraryPeekConfirm: (selectedIds: string[]) => void;
  spellStackModalOpen: boolean;
  stack: StackObject[];
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
  revealedDeckCard,
  viewingZone,
  onCloseZone,
  libraryPeekModal,
  onLibraryPeekConfirm,
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
      <PromptModalHost currentPrompt={currentPrompt} ctx={{ sourceDeckCard, revealedDeckCard }} />
      {/*{import.meta.env.DEV && <ChooseFromSelectionModalPreview />}*/}
      {/*{import.meta.env.DEV && <ChooseBooleanModalPreview />}*/}
      <GameOverlays
        viewingZone={viewingZone}
        onCloseZone={onCloseZone}
        libraryPeekModal={libraryPeekModal}
        onLibraryPeekConfirm={onLibraryPeekConfirm}
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
