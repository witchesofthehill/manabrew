import { Fragment, useState, type ReactNode } from "react";
import { ChooseOptionalTriggerModal } from "./ChooseOptionalTriggerModal";
import { ChooseColorModal } from "./ChooseColorModal";
import { ChooseTypeModal } from "./ChooseTypeModal";
import { ChooseNumberModal } from "./ChooseNumberModal";
import { ChooseCardNameModal } from "./ChooseCardNameModal";
import { ChooseCardsModal } from "./ChooseCardsModal";
import { VAssignCombatDamageModal } from "./VAssignCombatDamageModal";
import { ReorderLibraryModal } from "./ReorderLibraryModal";
import { RevealCardsModal } from "./RevealCardsModal";
import { SpecifyManaComboModal } from "./SpecifyManaComboModal";
import { LibraryPeekModal } from "./LibraryPeekModal";
import { PayCombatCostModal } from "./PayCombatCostModal";
import { PromptModalController } from "./PromptModalController";
import { ChooseBooleanModal } from "./ChooseBooleanModal";
import { ChooseFromSelectionModal } from "./ChooseFromSelectionModal";
import { MultikickerModal } from "./MultikickerModal";
import { ReplicateModal } from "./ReplicateModal";
import { DiceRollFeedback, FirstPlayerRollFeedback } from "@/components/game/dice";
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
  revealCards: ({ prompt, respond }) => <RevealCardsModal input={prompt.input} respond={respond} />,

  chooseColor: ({ prompt, respond }) => <ChooseColorModal input={prompt.input} respond={respond} />,

  chooseType: ({ prompt, respond }) => <ChooseTypeModal input={prompt.input} respond={respond} />,

  // $PROMPT_SHARED
  chooseNumber: ({ prompt, respond, ctx }) => (
    <ChooseNumberModal
      min={prompt.input.min}
      max={prompt.input.max}
      sourceCard={ctx.sourceDeckCard}
      onConfirm={(chosenNumber) => respond({ type: "numberDecision", chosenNumber })}
    />
  ),

  chooseCardName: ({ prompt, respond }) => (
    <ChooseCardNameModal input={prompt.input} respond={respond} />
  ),

  // $PROMPT_SHARED
  scry: ({ prompt, respond }) => (
    <LibraryPeekModal
      mode="scry"
      cards={prompt.input.cards as GameCard[]}
      onConfirm={(bottomCardIds) => respond({ type: "scryDecision", bottomCardIds })}
    />
  ),

  // $PROMPT_SHARED
  surveil: ({ prompt, respond }) => (
    <LibraryPeekModal
      mode="surveil"
      cards={prompt.input.cards as GameCard[]}
      onConfirm={(graveyardCardIds) => respond({ type: "surveilDecision", graveyardCardIds })}
    />
  ),

  // $PROMPT_SHARED
  dig: ({ prompt, respond }) => (
    <LibraryPeekModal
      mode="dig"
      cards={prompt.input.cards as GameCard[]}
      numToTake={prompt.input.numToTake}
      optional={prompt.input.optional}
      onConfirm={(chosenCardIds) => respond({ type: "digDecision", chosenCardIds })}
    />
  ),

  // $PROMPT_SHARED
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

  chooseCombatDamageAssignment: ({ prompt, respond }) => (
    <VAssignCombatDamageModal input={prompt.input} respond={respond} />
  ),

  reorderLibrary: ({ prompt, respond }) => (
    <ReorderLibraryModal input={prompt.input} respond={respond} />
  ),

  specifyManaCombo: ({ prompt, respond }) => (
    <SpecifyManaComboModal input={prompt.input} respond={respond} />
  ),

  // $PROMPT_SHARED
  exploreDecision: ({ prompt, respond, ctx }) => (
    <ChooseOptionalTriggerModal
      description={`Exploring revealed ${prompt.input.revealedCardName} (nonland). Put it in graveyard or leave on top of library?`}
      sourceCard={ctx.revealedDeckCard}
      promptKind="explore_decision"
      optionLabels={["Put on top of library", "Put in graveyard"]}
      onConfirm={(putInGraveyard) => respond({ type: "exploreResponse", putInGraveyard })}
    />
  ),

  // $PROMPT_SHARED
  helpPayAssist: ({ prompt, respond, ctx }) => (
    <ChooseNumberModal
      min={0}
      max={prompt.input.maxGeneric}
      sourceCard={ctx.sourceDeckCard}
      onConfirm={(n) => respond({ type: "assistDecision", amountToPay: n ?? 0 })}
    />
  ),

  // $PROMPT_SHARED
  firstPlayerRoll: ({ prompt, respond, ctx }) => (
    <FirstPlayerRollFeedback
      sides={prompt.input.sides}
      rolls={prompt.input.firstPlayerRolls}
      winnerPlayerId={prompt.input.winnerPlayerId}
      players={(ctx.gameView?.players ?? []).map((p) => ({ id: p.id, isHuman: p.isHuman }))}
      onAcknowledge={() => respond({ type: "firstPlayerRollAcknowledged" })}
    />
  ),

  // $PROMPT_SHARED
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

  chooseBoolean: ({ prompt, respond }) => (
    <ChooseBooleanModal input={prompt.input} respond={respond} />
  ),

  chooseFromSelection: ({ prompt, respond }) => (
    <ChooseFromSelectionModal input={prompt.input} respond={respond} />
  ),

  chooseMultikicker: ({ prompt, respond }) => (
    <MultikickerModal input={prompt.input} respond={respond} />
  ),

  chooseReplicate: ({ prompt, respond }) => (
    <ReplicateModal input={prompt.input} respond={respond} />
  ),

  payCombatCost: ({ prompt, respond }) => (
    <PayCombatCostModal input={prompt.input} respond={respond} />
  ),

  // $PROMPT_SHARED
  chooseDelve: ({ prompt, respond }) => (
    <ChooseCardsModal
      cards={prompt.input.zoneCards as GameCard[]}
      minChoices={0}
      maxChoices={prompt.input.maxCards}
      onConfirm={(chosenCardIds) => respond({ type: "delveDecision", chosenCardIds })}
    />
  ),

  // $PROMPT_SHARED
  chooseCardsForEffect: ({ prompt, respond, ctx }) => (
    <ChooseCardsModal
      cards={prompt.input.zoneCards as GameCard[]}
      minChoices={prompt.input.minChoices}
      maxChoices={prompt.input.maxChoices}
      sourceCardName={prompt.input.sourceCardName ?? ctx.sourceDeckCard?.name}
      optional={prompt.input.optional ?? false}
      onConfirm={(chosenCardIds) => respond({ type: "chooseCardsDecision", chosenCardIds })}
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
