import { Fragment, useState, type ReactNode } from "react";
import { ChooseColorModal } from "./ChooseColorModal";
import { ChooseTypeModal } from "./ChooseTypeModal";
import { ChooseNumberModal } from "./ChooseNumberModal";
import { ChooseCardNameModal } from "./ChooseCardNameModal";
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
import type { DeckCard, GameView } from "@/types/manabrew";

export type PromptOf<T extends PromptType> = Extract<Prompt, { input: { type: T } }>;

export interface PromptModalContext {
  sourceDeckCard?: DeckCard;
  gameView?: GameView | null;
}

export interface PromptComponentProps<T extends PromptType> {
  prompt: PromptOf<T>;
  respond: (output: PromptOutput["output"]) => void;
  ctx: PromptModalContext;
}

type PromptComponent<T extends PromptType> = (props: PromptComponentProps<T>) => ReactNode;

const PROMPT_MODALS: { [T in PromptType]?: PromptComponent<T> } = {
  revealCards: ({ prompt, respond }) => (
    <ChooseCardsModal
      cards={prompt.input.cards}
      presentation={{
        title: "Revealed cards",
        description: prompt.input.message,
        targets: [],
      }}
      min={0}
      max={0}
      reveal
      onConfirm={() => respond({ type: "revealCardsAcknowledged" })}
    />
  ),

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

  chooseCards: ({ prompt, respond }) => (
    <ChooseCardsModal
      cards={prompt.input.cards}
      presentation={prompt.input.presentation}
      min={prompt.input.min}
      max={prompt.input.max}
      onConfirm={(chosenCardIds) => respond({ type: "chooseCardsDecision", chosenCardIds })}
    />
  ),

  chooseCombatDamageAssignment: ({ prompt, respond }) => (
    <VAssignCombatDamageModal input={prompt.input} respond={respond} />
  ),

  reorderCards: ({ prompt, respond }) => (
    <ReorderCardsModal input={prompt.input} respond={respond} />
  ),

  // $PROMPT_SHARED
  diceRolled: ({ prompt, respond, ctx }) => (
    <DiceRollFeedback
      sides={prompt.input.sides}
      rolls={prompt.input.rolls}
      title={prompt.input.title}
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
