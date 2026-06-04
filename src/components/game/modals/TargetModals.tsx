import {
  ZoneViewer,
  LibraryPeekModal,
  type LibraryPeekMode,
  SpellStackModal,
  ChooseCardsModal,
  AbilityPickerModal,
  PromptModalController,
} from "@/components/game/modals";
import { ZoneTargetSelector } from "@/components/game/ZoneTargetSelector";
import type { DeckCard, GameCard, StackObject } from "@/types/manabrew";
import type { AgentPrompt } from "@/stores/useGameStore";
import type { AbilityPickerState, HandActionOption } from "@/stores/useGameUIStore";
import type { PromptType } from "@/types/promptType";
import { PromptType as PT } from "@/types/promptType";

interface TargetModalsProps {
  promptType?: PromptType;
  currentPrompt: AgentPrompt | null;
  sourceDeckCard?: DeckCard;
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
  onChooseCardsDecision: (cardIds: string[]) => void;
  onExertDecision: (chosenAttackerIds: string[]) => void;
  onEnlistDecision: (chosenAttackerIds: string[]) => void;
}

export function TargetModals({
  promptType,
  currentPrompt,
  sourceDeckCard,
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
  onChooseCardsDecision,
  onExertDecision,
  onEnlistDecision,
}: TargetModalsProps) {
  const isActiveTargetPromptModal =
    (promptType === PT.ChooseCardsForEffect && currentPrompt?.zoneCards != null) ||
    (promptType === PT.ChooseExertAttackers && currentPrompt?.attackerCards != null) ||
    (promptType === PT.ChooseEnlistAttackers && currentPrompt?.attackerCards != null);

  return (
    <>
      {viewingZone && (
        <ZoneViewer
          title={viewingZone.title}
          cards={viewingZone.cards}
          onClose={onCloseZone}
          onClickCard={viewingZone.onClickCard}
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

      <PromptModalController isActive={isActiveTargetPromptModal} promptStateKey={currentPrompt}>
        {promptType === PT.ChooseCardsForEffect && currentPrompt?.zoneCards != null && (
          <ChooseCardsModal
            cards={currentPrompt.zoneCards}
            minChoices={currentPrompt.minChoices ?? 1}
            maxChoices={currentPrompt.maxChoices ?? 1}
            sourceCardName={sourceDeckCard?.name}
            description={currentPrompt.description}
            onConfirm={onChooseCardsDecision}
          />
        )}

        {promptType === PT.ChooseExertAttackers && currentPrompt?.attackerCards != null && (
          <ChooseCardsModal
            cards={currentPrompt.attackerCards}
            minChoices={0}
            maxChoices={currentPrompt.attackerCards.length}
            sourceCardName="Exert Attackers"
            description="Choose which attacking creatures to exert. Exerted creatures won't untap during your next untap step."
            onConfirm={onExertDecision}
          />
        )}

        {promptType === PT.ChooseEnlistAttackers && currentPrompt?.attackerCards != null && (
          <ChooseCardsModal
            cards={currentPrompt.attackerCards}
            minChoices={0}
            maxChoices={currentPrompt.attackerCards.length}
            sourceCardName="Enlist Attackers"
            description="Choose which attacking creatures to enlist. Enlisted creatures tap a non-attacking creature to add its power."
            onConfirm={onEnlistDecision}
          />
        )}
      </PromptModalController>
    </>
  );
}
