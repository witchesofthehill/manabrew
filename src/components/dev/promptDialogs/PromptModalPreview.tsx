import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { PromptActionSpec } from "@/components/game/game.types";
import { registerModal } from "@/lib/modalStack";
import { BoardOverlayCanvas } from "@/pixi/BoardOverlayCanvas";
import type { PromptOverlaySpec } from "@/pixi/prompts/prompt.types";
import type { StackSpec } from "@/pixi/stack/stack.types";
import type { Prompt } from "@/protocol";

import type { DevDialogPreview } from "../promptDialogPreviews";
import type { DevDialogFixtures } from "./useDevDialogFixtures";
import { previewInput } from "@/components/dev/gameplayPromptFixtures";

interface PromptModalPreviewProps {
  preview: DevDialogPreview;
  fixtures: DevDialogFixtures;
  onClose: () => void;
}

const noAction = (): void => undefined;

const EMPTY_STACK: StackSpec = {
  cards: [],
  flash: null,
  showPreStackFlash: false,
  collapsed: true,
};

export function PromptModalPreview({ preview, fixtures, onClose }: PromptModalPreviewProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => registerModal(panelRef.current!), []);
  const [damageOrder, setDamageOrder] = useState<string[]>([]);
  const input = useMemo(() => previewInput(preview, fixtures), [preview, fixtures]);
  const prompt = useMemo<Prompt>(() => ({ input }) as Prompt, [input]);
  const blockerCards = useMemo(() => fixtures.cards.slice(1, 3), [fixtures.cards]);
  const spec = useMemo<PromptOverlaySpec>(() => {
    const action: PromptActionSpec = {
      promptType: input.type,
      isWaitingForResponse: false,
      isWaitingForOthers: false,
      availableAttackerIds: [],
      pendingAttackers: [],
      onPassPriority: noAction,
      onPassEndTurn: noAction,
      multipleAttackDefenders: false,
      attackAssignmentCount: 0,
      onDeclareAttackers: noAction,
      onBeginAttackTargetPick: noAction,
      onSubmitAttack: noAction,
      pendingAttacker: null,
      pendingBlocker: null,
      attackerIds: [],
      blockAssignments: [],
      combatPairings: [],
      onDeclareBlockers: noAction,
      damageOrderCount: damageOrder.length,
      damageOrderTotal: blockerCards.length,
      onConfirmDamageOrder: onClose,
      onUndoDamageOrder: () => setDamageOrder((current) => current.slice(0, -1)),
      onDefaultDamageOrder: () => setDamageOrder(blockerCards.map((card) => card.id)),
      onOpenStack: noAction,
      onToggleBoardMenu: noAction,
      resolveCardName: (cardId) => cardId,
      resolveCard: () => undefined,
      turn: fixtures.gameView.turn,
      activePlayerName: fixtures.me.name,
      isMyTurn: true,
      step: fixtures.gameView.step,
      payManaCostInfo: null,
      onPayManaCost: noAction,
      onAutoManaCost: noAction,
      onCancelManaCost: noAction,
    };

    return {
      currentPrompt: prompt,
      localPlayerId: fixtures.me.id,
      gameView: fixtures.gameView,
      sourceDeckCard:
        input.type === "chooseCombatDamageAssignment" ||
        input.type === "chooseDamageAssignmentOrder"
          ? undefined
          : fixtures.sourceCard,
      action,
      damageOrder:
        input.type === "chooseDamageAssignmentOrder"
          ? {
              attackerName: fixtures.cards[0]!.identity.name,
              blockerCards,
              order: damageOrder,
              onToggle: (cardId) =>
                setDamageOrder((current) =>
                  current.includes(cardId)
                    ? current.filter((candidate) => candidate !== cardId)
                    : [...current, cardId],
                ),
              onUndo: () => setDamageOrder((current) => current.slice(0, -1)),
              onAuto: () => setDamageOrder(blockerCards.map((card) => card.id)),
              onConfirm: onClose,
            }
          : null,
      gameOver:
        preview === "game-over"
          ? {
              winnerId: fixtures.me.id,
              me: fixtures.me,
              opponents: fixtures.opponents,
              turn: fixtures.gameView.turn,
              onEndGame: onClose,
            }
          : null,
      modalHidden: false,
      respond: onClose,
      onHideModal: onClose,
      onShowModal: noAction,
    };
  }, [blockerCards, damageOrder, fixtures, input.type, onClose, preview, prompt]);

  return createPortal(
    <>
      <div className="pointer-events-none fixed inset-0 z-[9998]">
        <div ref={panelRef} className="h-full" role="dialog" aria-label="Prompt preview">
          <BoardOverlayCanvas
            scene={null}
            stackSpec={EMPTY_STACK}
            onOpenStack={noAction}
            onTargetSpell={noAction}
            onHoverStack={noAction}
            onToggleStack={noAction}
            promptSpec={spec}
          />
        </div>
      </div>
    </>,
    document.body,
  );
}
