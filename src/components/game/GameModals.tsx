import { PromptModals } from "@/components/game/modals/PromptModals";
import { CostModals } from "@/components/game/modals/CostModals";
import { TargetModals } from "@/components/game/modals/TargetModals";
import type { LibraryPeekMode } from "@/components/game/modals";
import type { DeckCard, GameCard, StackObject } from "@/types/manabrew";
import type { AgentPrompt } from "@/stores/useGameStore";
import type { AbilityPickerState, HandActionOption } from "@/stores/useGameUIStore";
import type { PromptType } from "@/types/promptType";

interface GameModalsProps {
  promptType?: PromptType;
  currentPrompt: AgentPrompt | null;
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
  onModeDecision: (indices: number[]) => void;
  onRevealCardsAcknowledged: () => void;
  onPayCostToPreventEffectDecision: (accept: boolean) => void;
  onOptionalTriggerDecision: (accept: boolean) => void;
  onPhyrexianDecision: (payLife: boolean) => void;
  onKickerDecision: (kicked: boolean) => void;
  onBuybackDecision: (paid: boolean) => void;
  onMultikickerDecision: (kickCount: number) => void;
  onReplicateDecision: (replicateCount: number) => void;
  onAlternativeCostDecision: (chosenIndex: number) => void;
  onColorDecision: (color: string) => void;
  onChooseCardsDecision: (cardIds: string[]) => void;
  onTypeDecision: (chosenType: string | null) => void;
  onNumberDecision: (chosenNumber: number | null) => void;
  onCardNameDecision: (chosenName: string | null) => void;
  onScryDecision: (bottomCardIds: string[]) => void;
  onSurveilDecision: (graveyardCardIds: string[]) => void;
  onDigDecision: (chosenCardIds: string[]) => void;
  onDiscardDecision: (discardedCardIds: string[]) => void;
  onDamageOrderDecision: (orderedBlockerIds: string[]) => void;
  onCombatDamageAssignmentDecision: (assignments: { assigneeId: string; damage: number }[]) => void;
  onPayCombatCost: () => void;
  onDeclineCombatCost: () => void;

  onDelveDecision: (cardIds: string[]) => void;
  onConvokeDecision: (cardIds: string[]) => void;
  onImproviseDecision: (cardIds: string[]) => void;
  onManaComboDecision: (chosenColors: string[]) => void;
  onExploreDecision: (putInGraveyard: boolean) => void;
  onExertDecision: (chosenAttackerIds: string[]) => void;
  onEnlistDecision: (chosenAttackerIds: string[]) => void;
  onReorderLibraryDecision: (orderedCardIds: string[]) => void;
  onAssistDecision: (amountToPay: number) => void;
  onDiceRolledAcknowledged: () => void;
  onRollToIgnoreDecision: (roll: number | null) => void;
  onRollToSwapDecision: (roll: number | null) => void;
  onRollToModifyDecision: (roll: number | null) => void;
  onDiceToRerollDecision: (rolls: number[]) => void;
  onRollSwapValueDecision: (choice: "power" | "toughness" | null) => void;
  onFirstPlayerRollAcknowledged: () => void;
}

export function GameModals({
  promptType,
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
  onModeDecision,
  onRevealCardsAcknowledged,
  onPayCostToPreventEffectDecision,
  onOptionalTriggerDecision,
  onPhyrexianDecision,
  onKickerDecision,
  onBuybackDecision,
  onMultikickerDecision,
  onReplicateDecision,
  onAlternativeCostDecision,
  onColorDecision,
  onChooseCardsDecision,
  onTypeDecision,
  onNumberDecision,
  onCardNameDecision,
  onScryDecision,
  onSurveilDecision,
  onDigDecision,
  onDiscardDecision,
  onDamageOrderDecision,
  onCombatDamageAssignmentDecision,
  onPayCombatCost,
  onDeclineCombatCost,
  onDelveDecision,
  onConvokeDecision,
  onImproviseDecision,
  onManaComboDecision,
  onExploreDecision,
  onExertDecision,
  onEnlistDecision,
  onReorderLibraryDecision,
  onAssistDecision,
  onDiceRolledAcknowledged,
  onRollToIgnoreDecision,
  onRollToSwapDecision,
  onRollToModifyDecision,
  onDiceToRerollDecision,
  onRollSwapValueDecision,
  onFirstPlayerRollAcknowledged,
}: GameModalsProps) {
  return (
    <>
      <PromptModals
        promptType={promptType}
        currentPrompt={currentPrompt}
        sourceDeckCard={sourceDeckCard}
        revealedDeckCard={revealedDeckCard}
        onModeDecision={onModeDecision}
        onRevealCardsAcknowledged={onRevealCardsAcknowledged}
        onPayCostToPreventEffectDecision={onPayCostToPreventEffectDecision}
        onOptionalTriggerDecision={onOptionalTriggerDecision}
        onColorDecision={onColorDecision}
        onTypeDecision={onTypeDecision}
        onNumberDecision={onNumberDecision}
        onCardNameDecision={onCardNameDecision}
        onScryDecision={onScryDecision}
        onSurveilDecision={onSurveilDecision}
        onDigDecision={onDigDecision}
        onDiscardDecision={onDiscardDecision}
        onDamageOrderDecision={onDamageOrderDecision}
        onCombatDamageAssignmentDecision={onCombatDamageAssignmentDecision}
        onReorderLibraryDecision={onReorderLibraryDecision}
        onManaComboDecision={onManaComboDecision}
        onExploreDecision={onExploreDecision}
        onAssistDecision={onAssistDecision}
        onDiceRolledAcknowledged={onDiceRolledAcknowledged}
        onRollToIgnoreDecision={onRollToIgnoreDecision}
        onRollToSwapDecision={onRollToSwapDecision}
        onRollToModifyDecision={onRollToModifyDecision}
        onDiceToRerollDecision={onDiceToRerollDecision}
        onRollSwapValueDecision={onRollSwapValueDecision}
        onFirstPlayerRollAcknowledged={onFirstPlayerRollAcknowledged}
      />
      <CostModals
        promptType={promptType}
        currentPrompt={currentPrompt}
        sourceDeckCard={sourceDeckCard}
        onPhyrexianDecision={onPhyrexianDecision}
        onKickerDecision={onKickerDecision}
        onBuybackDecision={onBuybackDecision}
        onMultikickerDecision={onMultikickerDecision}
        onReplicateDecision={onReplicateDecision}
        onAlternativeCostDecision={onAlternativeCostDecision}
        onPayCombatCost={onPayCombatCost}
        onDeclineCombatCost={onDeclineCombatCost}
        onDelveDecision={onDelveDecision}
        onConvokeDecision={onConvokeDecision}
        onImproviseDecision={onImproviseDecision}
      />
      <TargetModals
        promptType={promptType}
        currentPrompt={currentPrompt}
        sourceDeckCard={sourceDeckCard}
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
        onChooseCardsDecision={onChooseCardsDecision}
        onExertDecision={onExertDecision}
        onEnlistDecision={onEnlistDecision}
      />
    </>
  );
}
