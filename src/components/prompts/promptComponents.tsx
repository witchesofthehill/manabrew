import { Fragment, useState, type ReactNode } from "react";
import { ChooseColorModal } from "./ChooseColorModal";
import { ChooseTypeModal } from "./ChooseTypeModal";
import { ChooseNumberModal } from "./ChooseNumberModal";
import { ChooseCardNameModal } from "./ChooseCardNameModal";
import { CardListModal } from "./CardListModal";
import { ChooseCardsModal } from "./ChooseCardsModal";
import { ReorderCardsModal } from "./ReorderCardsModal";
import { VAssignCombatDamageModal } from "./VAssignCombatDamageModal";
import { RevealCardsModal } from "./RevealCardsModal";
import { SpecifyManaComboModal } from "./SpecifyManaComboModal";
import { LibraryPeekModal } from "./LibraryPeekModal";
import { ScryModal } from "./ScryModal";
import { PayCombatCostModal } from "./PayCombatCostModal";
import { PromptModalController } from "./PromptModalController";
import { ChooseBooleanModal } from "./ChooseBooleanModal";
import { ChooseFromSelectionModal } from "./ChooseFromSelectionModal";
import { DiceRollFeedback, FirstPlayerRollFeedback } from "@/components/game/dice";
import { useGameStore } from "@/stores/useGameStore";
import type { Prompt, PromptOutput, PromptType } from "@/protocol";
import type { DeckCard, GameCard, GameView } from "@/types/manabrew";

export type PromptOf<T extends PromptType> = Extract<Prompt, { input: { type: T } }>;

export interface PromptModalContext {
  sourceDeckCard?: DeckCard;
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
  chooseNumber: ({ prompt, respond }) => (
    <ChooseNumberModal input={prompt.input} respond={respond} />
  ),

  chooseCardName: ({ prompt, respond }) => (
    <ChooseCardNameModal input={prompt.input} respond={respond} />
  ),

  scry: ({ prompt, respond }) => <ScryModal input={prompt.input} respond={respond} />,

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

  chooseCards: ({ prompt, respond }) => <ChooseCardsModal input={prompt.input} respond={respond} />,

  chooseCombatDamageAssignment: ({ prompt, respond }) => (
    <VAssignCombatDamageModal input={prompt.input} respond={respond} />
  ),

  reorderCards: ({ prompt, respond }) => (
    <ReorderCardsModal input={prompt.input} respond={respond} />
  ),

  specifyManaCombo: ({ prompt, respond }) => (
    <SpecifyManaComboModal input={prompt.input} respond={respond} />
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

  payCombatCost: ({ prompt, respond }) => (
    <PayCombatCostModal input={prompt.input} respond={respond} />
  ),

  // $PROMPT_SHARED
  chooseDelve: ({ prompt, respond }) => (
    <CardListModal
      cards={prompt.input.zoneCards as GameCard[]}
      minChoices={0}
      maxChoices={prompt.input.maxCards}
      onConfirm={(chosenCardIds) => respond({ type: "delveDecision", chosenCardIds })}
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
