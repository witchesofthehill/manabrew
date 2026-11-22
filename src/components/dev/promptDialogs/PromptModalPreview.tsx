import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { HoverCardPreview } from "@/components/game/HoverCardPreview";
import { Button } from "@/components/ui/button";
import type { PromptActionSpec } from "@/components/game/game.types";
import { useCardPreview } from "@/hooks/useCardPreview";
import { useTheme } from "@/hooks/useTheme";
import { useIsMobileGame } from "@/hooks/useBreakpoints";
import { registerModal } from "@/lib/modalStack";
import { playSound } from "@/lib/soundRuntime";
import type { BoardOverlayPreviewSpec } from "@/pixi/BoardOverlayCanvas";
import { DesktopBoardOverlayCanvas } from "@/pixi/DesktopBoardOverlayCanvas";
import { MobileBoardOverlayCanvas } from "@/pixi/MobileBoardOverlayCanvas";
import type { PromptOverlaySpec } from "@/pixi/prompts/prompt.types";
import type { StackSpec } from "@/pixi/stack/stack.types";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import type { Prompt } from "@/protocol";

import type { DevDialogPreview } from "../promptDialogPreviews";
import type { DevDialogFixtures } from "./useDevDialogFixtures";
import { FALLBACK_CARDS } from "@/components/dev/gameplayDialogFixtures";
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
  const mobile = useIsMobileGame();
  const OverlayCanvas = mobile ? MobileBoardOverlayCanvas : DesktopBoardOverlayCanvas;
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => registerModal(panelRef.current!), []);
  const [damageOrder, setDamageOrder] = useState<string[]>([]);
  const [rematchRequests, setRematchRequests] = useState<string[]>([]);
  const toggleRematchRequest = (playerId: string) => {
    if (!rematchRequests.includes(playerId)) playSound("roomInvite");
    setRematchRequests((current) =>
      current.includes(playerId) ? current.filter((id) => id !== playerId) : [...current, playerId],
    );
  };
  const input = useMemo(() => previewInput(preview, fixtures), [preview, fixtures]);
  const prompt = useMemo<Prompt>(() => ({ input }) as Prompt, [input]);
  const blockerCards = useMemo(() => FALLBACK_CARDS.slice(1, 3), []);
  const cardPreview = useCardPreview([], { useTriggerPreference: true });
  const previewStyle = usePreferencesStore((state) => state.inGameCardPreviewStyle);
  const previewCard = cardPreview.hoveredCard;
  const overlayPreviewCard = previewCard
    ? { ...previewCard, zoneId: previewCard.zoneId ?? "prompt" }
    : null;
  const togglePreviewView = () => {
    const preferences = usePreferencesStore.getState();
    preferences.setInGameCardPreviewStyle(
      preferences.inGameCardPreviewStyle === "printed" ? "rules" : "printed",
    );
  };
  const rulesPreview: BoardOverlayPreviewSpec | null =
    previewStyle === "rules" && overlayPreviewCard && cardPreview.phase !== "hidden"
      ? {
          card: overlayPreviewCard,
          phase: cardPreview.phase === "closing" ? "closing" : "open",
          sticky: cardPreview.isSticky,
          placement: cardPreview.placement,
          showBackFace: cardPreview.showBackFace,
          suppressed: false,
          skipEnterAnimation: false,
          actions: [],
          mousePos: cardPreview.mousePos,
          anchorRect: cardPreview.anchorRect,
          reserveSidePanel: false,
        }
      : null;
  const externalPreviewActive = previewCard !== null && cardPreview.phase === "open";
  const turnColor = useTheme().gameTheme.playerColors.self;
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
      turnColor,
      turnHandoff: null,
      gameView:
        input.type === "chooseCombatDamageAssignment" ||
        input.type === "chooseDamageAssignmentOrder"
          ? {
              ...fixtures.gameView,
              battlefield: FALLBACK_CARDS.map((card) => ({
                ...card,
                zoneId: "battlefield",
              })),
            }
          : fixtures.gameView,
      sourceDeckCard:
        input.type === "chooseCombatDamageAssignment" ||
        input.type === "chooseDamageAssignmentOrder"
          ? undefined
          : fixtures.sourceCard,
      action,
      damageOrder:
        input.type === "chooseDamageAssignmentOrder"
          ? {
              attackerName: FALLBACK_CARDS[0]!.identity.name,
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
              engineCrash: null,
              statusMessage: rematchRequests.length
                ? null
                : `Waiting on ${new Intl.ListFormat("en").format(
                    fixtures.opponents.map((player) => player.name),
                  )}`,
              playerStatuses: Object.fromEntries(
                fixtures.opponents.map((player) => [
                  player.id,
                  rematchRequests.includes(player.id) ? "Ready" : "Deciding",
                ]),
              ),
              rematchRequests,
              ready: false,
              busy: false,
              onPlayAgain: onClose,
              onChangeDeck: onClose,
              onHome: onClose,
            }
          : null,
      modalHidden: false,
      respond: onClose,
      onHideModal: onClose,
      onShowModal: noAction,
      onOpenPhaseStopsHelp: noAction,
    };
  }, [
    blockerCards,
    damageOrder,
    fixtures,
    input.type,
    onClose,
    preview,
    prompt,
    rematchRequests,
    turnColor,
  ]);

  return createPortal(
    <>
      <div className="pointer-events-none fixed inset-0 z-[9998]">
        <div ref={panelRef} className="h-full" role="dialog" aria-label="Prompt preview">
          <OverlayCanvas
            scene={null}
            stackSpec={EMPTY_STACK}
            onTargetSpell={noAction}
            onHoverStack={noAction}
            onToggleStack={noAction}
            promptSpec={spec}
            externalPreviewActive={externalPreviewActive}
            previewSpec={rulesPreview}
            onPreviewPointerEnter={cardPreview.onMouseEnterPreview}
            onPreviewPointerLeave={cardPreview.onMouseLeavePreview}
            onDismissPreview={cardPreview.dismiss}
            onFlipPreview={cardPreview.flipCard}
            onTogglePreviewView={togglePreviewView}
            onLongPressCard={(card, anchor) => {
              cardPreview.showSticky(
                card,
                anchor.left + anchor.width / 2,
                anchor.top + anchor.height / 2,
                anchor,
                { allowOverModal: true },
              );
            }}
          />
          {preview === "game-over" && (
            <div className="pointer-events-auto fixed left-1/2 top-4 z-[1] flex -translate-x-1/2 flex-wrap justify-center gap-2 rounded-md border border-border bg-card p-2 text-ui-label">
              {fixtures.opponents.map((player) => {
                const requested = rematchRequests.includes(player.id);
                return (
                  <Button
                    key={player.id}
                    size="sm"
                    variant={requested ? "selected" : "outline"}
                    onClick={() => toggleRematchRequest(player.id)}
                  >
                    {requested ? `${player.name}: cancel vote` : `${player.name}: play again`}
                  </Button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {previewStyle === "printed" && (
        <HoverCardPreview preview={cardPreview} onToggleView={togglePreviewView} />
      )}
    </>,
    document.body,
  );
}
