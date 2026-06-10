import { Fragment, useState, type ReactNode } from "react";
import {
  ChooseModeModal,
  ChooseOptionalTriggerModal,
  ChooseColorModal,
  ChooseTypeModal,
  ChooseNumberModal,
  ChooseCardNameModal,
  ChooseCardsModal,
  DamageOrderModal,
  VAssignCombatDamageModal,
  ReorderLibraryModal,
  RevealCardsModal,
  SpecifyManaComboModal,
  LibraryPeekModal,
  PayCombatCostModal,
  PromptModalController,
} from "@/components/game/modals";
import {
  KickerModal,
  BuybackModal,
  MultikickerModal,
  ReplicateModal,
  AlternativeCostModal,
  PhyrexianModal,
} from "@/components/game/cost-modals";
import {
  DiceRollFeedback,
  FirstPlayerRollFeedback,
  ChooseRollToIgnoreModal,
  ChooseRollToSwapModal,
  ChooseRollToModifyModal,
  ChooseDiceToRerollModal,
  ChooseRollSwapValueModal,
} from "@/components/game/dice";
import { useGameStore } from "@/stores/useGameStore";
import type { Prompt, PromptOutput, PromptType } from "@/protocol";
import type { DeckCard, GameCard, GameView } from "@/types/manabrew";

export type PromptOf<T extends PromptType> = Extract<Prompt, { input: { type: T } }>;

export interface PromptModalContext {
  sourceDeckCard?: DeckCard;
  revealedDeckCard?: DeckCard;
  gameView?: GameView | null;
}

export interface PromptComponentProps<T extends PromptType> {
  prompt: PromptOf<T>;
  respond: (output: PromptOutput) => void;
  ctx: PromptModalContext;
}

type PromptComponent<T extends PromptType> = (props: PromptComponentProps<T>) => ReactNode;

const PROMPT_MODALS: { [T in PromptType]?: PromptComponent<T> } = {
  revealCards: ({ prompt, respond }) => (
    <RevealCardsModal
      cards={prompt.input.cards}
      message={prompt.input.message}
      onConfirm={() => respond({ type: "revealCardsAcknowledged" })}
    />
  ),

  chooseMode: ({ prompt, respond, ctx }) => (
    <ChooseModeModal
      options={prompt.input.options}
      minChoices={prompt.input.minChoices}
      maxChoices={prompt.input.maxChoices}
      sourceCard={ctx.sourceDeckCard}
      sourceLabel={prompt.input.sourceCardName ?? undefined}
      onConfirm={(chosenIndices) => respond({ type: "modeDecision", chosenIndices })}
    />
  ),

  chooseOptionalTrigger: ({ prompt, respond, ctx }) => (
    <ChooseOptionalTriggerModal
      description={prompt.input.description}
      sourceCard={ctx.sourceDeckCard}
      sourceCardId={prompt.sourceCardId}
      cards={prompt.input.cards}
      promptKind={prompt.input.promptKind ?? undefined}
      optionLabels={prompt.input.optionLabels ?? undefined}
      mode={prompt.input.mode ?? undefined}
      api={prompt.input.api ?? undefined}
      onConfirm={(accept) => respond({ type: "optionalTriggerDecision", accept })}
    />
  ),

  payCostToPreventEffect: ({ prompt, respond, ctx }) => (
    <ChooseOptionalTriggerModal
      description={prompt.input.description}
      sourceCard={ctx.sourceDeckCard}
      promptKind="confirm_payment"
      optionLabels={["Decline", "Accept"]}
      mode={prompt.input.costKind}
      api={prompt.input.api ?? undefined}
      onConfirm={(accept) => respond({ type: "payCostToPreventEffectDecision", accept })}
    />
  ),

  chooseColor: ({ prompt, respond }) => (
    <ChooseColorModal
      validColors={prompt.input.validColors}
      onConfirm={(color) => respond({ type: "colorDecision", color })}
    />
  ),

  chooseType: ({ prompt, respond, ctx }) => (
    <ChooseTypeModal
      typeCategory={prompt.input.typeCategory}
      validTypes={prompt.input.validTypes}
      sourceCard={ctx.sourceDeckCard}
      onConfirm={(chosenType) => respond({ type: "typeDecision", chosenType })}
    />
  ),

  chooseNumber: ({ prompt, respond, ctx }) => (
    <ChooseNumberModal
      min={prompt.input.min}
      max={prompt.input.max}
      sourceCard={ctx.sourceDeckCard}
      onConfirm={(chosenNumber) => respond({ type: "numberDecision", chosenNumber })}
    />
  ),

  chooseCardName: ({ prompt, respond, ctx }) => (
    <ChooseCardNameModal
      validNames={prompt.input.validNames}
      sourceCard={ctx.sourceDeckCard}
      onConfirm={(chosenName) => respond({ type: "cardNameDecision", chosenName })}
    />
  ),

  scry: ({ prompt, respond }) => (
    <LibraryPeekModal
      mode="scry"
      cards={prompt.input.cards}
      onConfirm={(bottomCardIds) => respond({ type: "scryDecision", bottomCardIds })}
    />
  ),

  surveil: ({ prompt, respond }) => (
    <LibraryPeekModal
      mode="surveil"
      cards={prompt.input.cards}
      onConfirm={(graveyardCardIds) => respond({ type: "surveilDecision", graveyardCardIds })}
    />
  ),

  dig: ({ prompt, respond }) => (
    <LibraryPeekModal
      mode="dig"
      cards={prompt.input.cards}
      numToTake={prompt.input.numToTake}
      optional={prompt.input.optional}
      onConfirm={(chosenCardIds) => respond({ type: "digDecision", chosenCardIds })}
    />
  ),

  chooseDiscard: ({ prompt, respond, ctx }) => (
    <LibraryPeekModal
      mode="discard"
      cards={prompt.input.handCardIds
        .map((id) =>
          (ctx.gameView?.players.flatMap((p) => p.hand) ?? []).find((card) => card.id === id),
        )
        .filter((card): card is GameCard => card != null)}
      numToTake={prompt.input.numToDiscard}
      onConfirm={(discardedCardIds) => respond({ type: "discardDecision", discardedCardIds })}
    />
  ),

  chooseDamageAssignmentOrder: ({ prompt, respond, ctx }) => (
    <DamageOrderModal
      attackerId={prompt.input.attackerId}
      blockerIds={prompt.input.blockerIds}
      blockerCards={prompt.input.blockerCards}
      gameViewCards={ctx.gameView?.battlefield ?? []}
      onConfirm={(orderedBlockerIds) =>
        respond({ type: "damageAssignmentOrderDecision", orderedBlockerIds })
      }
    />
  ),

  chooseCombatDamageAssignment: ({ prompt, respond, ctx }) => (
    <VAssignCombatDamageModal
      attackerId={prompt.input.attackerId}
      blockerIds={prompt.input.blockerIds}
      defenderId={prompt.input.defenderId}
      totalDamage={prompt.input.totalDamage}
      attackerHasDeathtouch={prompt.input.attackerHasDeathtouch}
      gameView={ctx.gameView!}
      onConfirm={(assignments) => respond({ type: "combatDamageAssignmentDecision", assignments })}
    />
  ),

  reorderLibrary: ({ prompt, respond, ctx }) => (
    <ReorderLibraryModal
      cards={prompt.input.cards}
      sourceCard={ctx.sourceDeckCard}
      onConfirm={(orderedCardIds) => respond({ type: "reorderLibraryDecision", orderedCardIds })}
    />
  ),

  specifyManaCombo: ({ prompt, respond }) => (
    <SpecifyManaComboModal
      availableColors={prompt.input.availableColors}
      amount={prompt.input.amount}
      onConfirm={(chosenColors) => respond({ type: "manaComboDecision", chosenColors })}
    />
  ),

  exploreDecision: ({ prompt, respond, ctx }) => (
    <ChooseOptionalTriggerModal
      description={`Exploring revealed ${prompt.input.revealedCardName} (nonland). Put it in graveyard or leave on top of library?`}
      sourceCard={ctx.revealedDeckCard}
      promptKind="explore_decision"
      optionLabels={["Put on top of library", "Put in graveyard"]}
      onConfirm={(putInGraveyard) => respond({ type: "exploreResponse", putInGraveyard })}
    />
  ),

  helpPayAssist: ({ prompt, respond, ctx }) => (
    <ChooseNumberModal
      min={0}
      max={prompt.input.maxGeneric}
      sourceCard={ctx.sourceDeckCard}
      onConfirm={(n) => respond({ type: "assistDecision", amountToPay: n ?? 0 })}
    />
  ),

  firstPlayerRoll: ({ prompt, respond, ctx }) => (
    <FirstPlayerRollFeedback
      sides={prompt.input.sides}
      rolls={prompt.input.firstPlayerRolls}
      winnerPlayerId={prompt.input.winnerPlayerId}
      players={(ctx.gameView?.players ?? []).map((p) => ({ id: p.id, isHuman: p.isHuman }))}
      onAcknowledge={() => respond({ type: "firstPlayerRollAcknowledged" })}
    />
  ),

  diceRolled: ({ prompt, respond, ctx }) => (
    <DiceRollFeedback
      sides={prompt.input.sides}
      naturalResults={prompt.input.naturalResults}
      finalResults={prompt.input.finalResults}
      ignoredRolls={prompt.input.ignoredRolls}
      playerId={prompt.input.playerId}
      players={(ctx.gameView?.players ?? []).map((p) => ({ id: p.id, isHuman: p.isHuman }))}
      sourceCard={ctx.sourceDeckCard}
      onAcknowledge={() => respond({ type: "diceRolledAcknowledged" })}
    />
  ),

  chooseRollToIgnore: ({ prompt, respond, ctx }) => (
    <ChooseRollToIgnoreModal
      rolls={prompt.input.rolls}
      sides={prompt.input.sides}
      sourceCard={ctx.sourceDeckCard}
      onConfirm={(roll) => respond({ type: "rollToIgnoreDecision", roll })}
    />
  ),

  chooseRollToSwap: ({ prompt, respond, ctx }) => (
    <ChooseRollToSwapModal
      rolls={prompt.input.rolls}
      sides={prompt.input.sides}
      sourceCard={ctx.sourceDeckCard}
      onConfirm={(roll) => respond({ type: "rollToSwapDecision", roll })}
    />
  ),

  chooseRollToModify: ({ prompt, respond, ctx }) => (
    <ChooseRollToModifyModal
      rolls={prompt.input.rolls}
      sides={prompt.input.sides}
      sourceCard={ctx.sourceDeckCard}
      onConfirm={(roll) => respond({ type: "rollToModifyDecision", roll })}
    />
  ),

  chooseDiceToReroll: ({ prompt, respond, ctx }) => (
    <ChooseDiceToRerollModal
      rolls={prompt.input.rolls}
      sides={prompt.input.sides}
      sourceCard={ctx.sourceDeckCard}
      onConfirm={(rolls) => respond({ type: "diceToRerollDecision", rolls })}
    />
  ),

  chooseRollSwapValue: ({ prompt, respond, ctx }) => (
    <ChooseRollSwapValueModal
      currentResult={prompt.input.currentResult}
      power={prompt.input.power}
      toughness={prompt.input.toughness}
      sourceCard={ctx.sourceDeckCard}
      onConfirm={(choice) => respond({ type: "rollSwapValueDecision", choice })}
    />
  ),

  choosePhyrexian: ({ prompt, respond, ctx }) => (
    <PhyrexianModal
      phyrexianColor={prompt.input.phyrexianColor}
      sourceCard={ctx.sourceDeckCard}
      onDecide={(payLife) => respond({ type: "phyrexianDecision", payLife })}
    />
  ),

  chooseKicker: ({ prompt, respond, ctx }) => (
    <KickerModal
      kickerCost={prompt.input.kickerCost}
      sourceCard={ctx.sourceDeckCard}
      onDecide={(kicked) => respond({ type: "kickerDecision", kicked })}
    />
  ),

  chooseBuyback: ({ prompt, respond, ctx }) => (
    <BuybackModal
      buybackCost={prompt.input.buybackCost}
      sourceCard={ctx.sourceDeckCard}
      onDecide={(buybackPaid) => respond({ type: "buybackDecision", buybackPaid })}
    />
  ),

  chooseMultikicker: ({ prompt, respond, ctx }) => (
    <MultikickerModal
      cost={prompt.input.cost}
      maxKicks={prompt.input.maxKicks}
      sourceCard={ctx.sourceDeckCard}
      onDecide={(kickCount) => respond({ type: "multikickerDecision", kickCount })}
    />
  ),

  chooseReplicate: ({ prompt, respond, ctx }) => (
    <ReplicateModal
      cost={prompt.input.cost}
      maxReplicates={prompt.input.maxReplicates}
      sourceCard={ctx.sourceDeckCard}
      onDecide={(replicateCount) => respond({ type: "replicateDecision", replicateCount })}
    />
  ),

  chooseAlternativeCost: ({ prompt, respond, ctx }) => (
    <AlternativeCostModal
      options={prompt.input.options}
      sourceCard={ctx.sourceDeckCard}
      onDecide={(chosenIndex) => respond({ type: "alternativeCostDecision", chosenIndex })}
    />
  ),

  payCombatCost: ({ prompt, respond, ctx }) => (
    <PayCombatCostModal
      attackerName={prompt.input.attackerName}
      cost={prompt.input.cost}
      description={prompt.input.description}
      manaPool={ctx.gameView?.players?.[0]?.manaPool ?? {}}
      onPay={() => respond({ type: "payCombatCost" })}
      onDecline={() => respond({ type: "declineCombatCost" })}
    />
  ),

  chooseDelve: ({ prompt, respond }) => (
    <ChooseCardsModal
      cards={prompt.input.zoneCards}
      minChoices={0}
      maxChoices={prompt.input.maxCards}
      onConfirm={(chosenCardIds) => respond({ type: "delveDecision", chosenCardIds })}
    />
  ),

  chooseConvoke: ({ prompt, respond, ctx }) => (
    <ChooseCardsModal
      cards={(ctx.gameView?.battlefield ?? []).filter((c) =>
        prompt.input.validCardIds.includes(c.id),
      )}
      minChoices={0}
      maxChoices={prompt.input.validCardIds.length}
      description={
        prompt.input.remainingCost ? `Remaining cost: ${prompt.input.remainingCost}` : undefined
      }
      onConfirm={(chosenCardIds) => respond({ type: "convokeDecision", chosenCardIds })}
    />
  ),

  chooseImprovise: ({ prompt, respond, ctx }) => (
    <ChooseCardsModal
      cards={(ctx.gameView?.battlefield ?? []).filter((c) =>
        prompt.input.validCardIds.includes(c.id),
      )}
      minChoices={0}
      maxChoices={prompt.input.validCardIds.length}
      description={
        prompt.input.remainingCost ? `Remaining cost: ${prompt.input.remainingCost}` : undefined
      }
      onConfirm={(chosenCardIds) => respond({ type: "improviseDecision", chosenCardIds })}
    />
  ),

  chooseCardsForEffect: ({ prompt, respond, ctx }) => (
    <ChooseCardsModal
      cards={prompt.input.zoneCards}
      minChoices={prompt.input.minChoices}
      maxChoices={prompt.input.maxChoices}
      sourceCardName={prompt.input.sourceCardName ?? ctx.sourceDeckCard?.name}
      onConfirm={(chosenCardIds) => respond({ type: "chooseCardsDecision", chosenCardIds })}
    />
  ),

  chooseExertAttackers: ({ prompt, respond }) => (
    <ChooseCardsModal
      cards={prompt.input.attackerCards}
      minChoices={0}
      maxChoices={prompt.input.attackerCards.length}
      sourceCardName="Exert Attackers"
      description="Choose which attacking creatures to exert. Exerted creatures won't untap during your next untap step."
      onConfirm={(chosenAttackerIds) => respond({ type: "exertDecision", chosenAttackerIds })}
    />
  ),

  chooseEnlistAttackers: ({ prompt, respond }) => (
    <ChooseCardsModal
      cards={prompt.input.attackerCards}
      minChoices={0}
      maxChoices={prompt.input.attackerCards.length}
      sourceCardName="Enlist Attackers"
      description="Choose which attacking creatures to enlist. Enlisted creatures tap a non-attacking creature to add its power."
      onConfirm={(chosenAttackerIds) => respond({ type: "enlistDecision", chosenAttackerIds })}
    />
  ),
};

export function PromptModalHost({
  currentPrompt,
  ctx,
}: {
  currentPrompt: Prompt | null;
  ctx: PromptModalContext;
}) {
  const respond = useGameStore((s) => s.respond);
  const gameView = useGameStore((s) => s.gameView);
  const input = currentPrompt?.input;
  const entry = (input ? PROMPT_MODALS[input.type] : undefined) as
    | PromptComponent<PromptType>
    | undefined;

  const [promptSeq, setPromptSeq] = useState(0);
  const [prevPrompt, setPrevPrompt] = useState(currentPrompt);
  if (prevPrompt !== currentPrompt) {
    setPrevPrompt(currentPrompt);
    setPromptSeq(promptSeq + 1);
  }

  return (
    <PromptModalController isActive={!!entry} promptStateKey={currentPrompt}>
      {entry && currentPrompt ? (
        <Fragment key={promptSeq}>
          {entry({ prompt: currentPrompt, respond, ctx: { ...ctx, gameView } })}
        </Fragment>
      ) : null}
    </PromptModalController>
  );
}
