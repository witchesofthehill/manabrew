import { Fragment, useState, type ReactNode } from "react";
import { ChooseColorModal } from "./ChooseColorModal";
import { ChooseCardNameModal } from "./ChooseCardNameModal";
import { ChooseNumberModal } from "./ChooseNumberModal";
import { ChooseCardsModal } from "./ChooseCardsModal";
import { ReorderCardsModal } from "./ReorderCardsModal";
import { VAssignCombatDamageModal } from "./VAssignCombatDamageModal";
import { ScryModal } from "./ScryModal";
import { PromptModalController } from "./PromptModalController";
import { ChooseBooleanModal } from "./ChooseBooleanModal";
import { ChooseFromSelectionModal } from "./ChooseFromSelectionModal";
import { DiceRollFeedback } from "@/components/game/dice";
import { useGameStore } from "@/stores/useGameStore";
import type { Prompt, PromptOutput, PromptType } from "@/protocol";
import type { GameViewDto } from "@/protocol/game";
import type { DeckCard } from "@/protocol/deck";

export type PromptOf<T extends PromptType> = Extract<Prompt, { input: { type: T } }>;

export interface PromptModalContext {
  sourceDeckCard?: DeckCard;
  gameView?: GameViewDto | null;
}

export interface PromptComponentProps<T extends PromptType> {
  prompt: PromptOf<T>;
  respond: (output: PromptOutput["output"]) => void;
  ctx: PromptModalContext;
}

type PromptComponent<T extends PromptType> = (props: PromptComponentProps<T>) => ReactNode;

const PROMPT_MODALS: { [T in PromptType]?: PromptComponent<T> } = {
  revealCards: ({ prompt, respond, ctx }) => (
    <ChooseCardsModal
      cards={prompt.input.cards}
      presentation={{
        title: "Revealed cards",
        description: prompt.input.presentation.title,
        targets: [],
      }}
      min={0}
      max={0}
      sourceCard={ctx.sourceDeckCard}
      reveal
      onConfirm={() => respond({ type: "revealCardsAcknowledged" })}
    />
  ),

  chooseColor: ({ prompt, respond, ctx }) => (
    <ChooseColorModal input={prompt.input} respond={respond} sourceCard={ctx.sourceDeckCard} />
  ),

  chooseCardName: ({ prompt, respond, ctx }) => (
    <ChooseCardNameModal input={prompt.input} respond={respond} sourceCard={ctx.sourceDeckCard} />
  ),

  // $PROMPT_SHARED
  chooseNumber: ({ prompt, respond, ctx }) => (
    <ChooseNumberModal input={prompt.input} respond={respond} sourceCard={ctx.sourceDeckCard} />
  ),

  scry: ({ prompt, respond, ctx }) => (
    <ScryModal input={prompt.input} respond={respond} sourceCard={ctx.sourceDeckCard} />
  ),

  chooseCards: ({ prompt, respond, ctx }) => (
    <ChooseCardsModal
      cards={prompt.input.cards}
      presentation={prompt.input.presentation}
      min={prompt.input.min}
      max={prompt.input.max}
      sourceCard={ctx.sourceDeckCard}
      onConfirm={(chosenCardIds) => respond({ type: "chooseCardsDecision", chosenCardIds })}
    />
  ),

  chooseCombatDamageAssignment: ({ prompt, respond }) => (
    <VAssignCombatDamageModal input={prompt.input} respond={respond} />
  ),

  reorder: ({ prompt, respond, ctx }) => (
    <ReorderCardsModal input={prompt.input} respond={respond} sourceCard={ctx.sourceDeckCard} />
  ),

  // $PROMPT_SHARED
  diceRolled: ({ prompt, respond, ctx }) => (
    <DiceRollFeedback
      sides={prompt.input.sides}
      rolls={prompt.input.rolls}
      title={prompt.input.presentation.title}
      players={(ctx.gameView?.players ?? []).map((p) => ({ id: p.id, isHuman: p.isHuman }))}
      sourceCard={ctx.sourceDeckCard}
      onAcknowledge={() => respond({ type: "diceRolledAcknowledged" })}
    />
  ),

  chooseBoolean: ({ prompt, respond, ctx }) => (
    <ChooseBooleanModal input={prompt.input} respond={respond} sourceCard={ctx.sourceDeckCard} />
  ),

  chooseFromSelection: ({ prompt, respond, ctx }) => (
    <ChooseFromSelectionModal
      input={prompt.input}
      respond={respond}
      sourceCard={ctx.sourceDeckCard}
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
