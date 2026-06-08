import {
  ZoneViewer,
  LibraryPeekModal,
  type LibraryPeekMode,
  SpellStackModal,
  AbilityPickerModal,
} from "@/components/game/modals";
import { ZoneTargetSelector } from "@/components/game/ZoneTargetSelector";
import type { GameCard, StackObject } from "@/types/manabrew";
import type { AbilityPickerState, HandActionOption } from "@/stores/useGameUIStore";

interface GameOverlaysProps {
  viewingZone: {
    title: string;
    cards: GameCard[];
    onClickCard?: (cardId: string) => void;
    clickableCardIds?: string[];
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

export function GameOverlays({
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
}: GameOverlaysProps) {
  return (
    <>
      {viewingZone && (
        <ZoneViewer
          title={viewingZone.title}
          cards={viewingZone.cards}
          onClose={onCloseZone}
          onClickCard={viewingZone.onClickCard}
          clickableCardIds={viewingZone.clickableCardIds}
        />
      )}

      {zoneTargetSelector && (
        <ZoneTargetSelector
          title={zoneTargetSelector.title}
          cards={zoneTargetSelector.cards}
          validCardIds={zoneTargetSelector.validCardIds}
          onSelect={onSelectZoneTarget}
          onCancel={onCancelZoneTarget}
        />
      )}

      {libraryPeekModal && (
        <LibraryPeekModal
          mode={libraryPeekModal.mode}
          cards={libraryPeekModal.cards}
          numToTake={libraryPeekModal.numToTake}
          optional={libraryPeekModal.optional}
          onConfirm={onLibraryPeekConfirm}
        />
      )}

      {spellStackModalOpen && stack.length > 0 && (
        <SpellStackModal
          stack={stack}
          validSpellIds={validSpellIds}
          onTarget={onTargetSpell}
          onCancel={onCloseStack}
          playerColorMap={playerColorMap}
        />
      )}

      {abilityPickerState?.card && (
        <AbilityPickerModal
          sourceCard={abilityPickerState.card}
          abilities={abilityPickerState.abilities}
          onSelect={onSelectAbility}
          onCancel={onCancelAbilityPicker}
        />
      )}
    </>
  );
}
