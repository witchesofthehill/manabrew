import { ZoneViewer, SpellStackModal, AbilityPickerModal } from "@/components/game/modals";
import type { GameCard, StackObject } from "@/types/manabrew";
import type { AbilityPickerState, HandActionOption } from "@/stores/useGameUIStore";

interface GameOverlaysProps {
  viewingZone: {
    title: string;
    cards: GameCard[];
    onClickCard?: (cardId: string) => void;
    clickableCardIds?: string[];
    selectedCardIds?: string[];
    clickLabel?: string;
    selectedLabel?: string;
    targetHostile?: boolean;
  } | null;
  onCloseZone: () => void;
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
          selectedCardIds={viewingZone.selectedCardIds}
          clickLabel={viewingZone.clickLabel}
          selectedLabel={viewingZone.selectedLabel}
          targetHostile={viewingZone.targetHostile}
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
