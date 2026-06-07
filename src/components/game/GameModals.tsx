import { PromptModalHost } from "@/components/game/prompts/promptComponents";
import { GameOverlays } from "@/components/game/GameOverlays";
import type { LibraryPeekMode } from "@/components/game/modals";
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
  } | null;
  onCloseZone: () => void;
  zoneTargetSelector: { title: string; cards: GameCard[]; validCardIds: string[] } | null;
  onSelectZoneTarget: (cardId: string) => void;
  onCancelZoneTarget: () => void;
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
  zoneTargetSelector,
  onSelectZoneTarget,
  onCancelZoneTarget,
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
      <GameOverlays
        viewingZone={viewingZone}
        onCloseZone={onCloseZone}
        zoneTargetSelector={zoneTargetSelector}
        onSelectZoneTarget={onSelectZoneTarget}
        onCancelZoneTarget={onCancelZoneTarget}
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
