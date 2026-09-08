import { useCallback, useMemo, useState } from "react";
import { createPortal, flushSync } from "react-dom";

import { HoverCardPreview } from "@/components/game/HoverCardPreview";
import type { PromptActionSpec } from "@/components/game/game.types";
import { useCardPreview } from "@/hooks/useCardPreview";
import { useKeybindings } from "@/hooks/useKeybindings";
import { BoardOverlayCanvas, type BoardOverlayPreviewSpec } from "@/pixi/BoardOverlayCanvas";
import type { PromptOverlaySpec } from "@/pixi/prompts/prompt.types";
import type { StackSpec } from "@/pixi/stack/stack.types";
import type { Prompt, PromptInput } from "@/protocol";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

import type { DevDialogPreview } from "../promptDialogPreviews";
import type { DevDialogFixtures } from "./useDevDialogFixtures";

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
  const [damageOrder, setDamageOrder] = useState<string[]>([]);
  const cardPreview = useCardPreview();
  const previewStyle = usePreferencesStore((state) => state.inGameCardPreviewStyle);
  const [previewViewSwitchCardId, setPreviewViewSwitchCardId] = useState<string | null>(null);
  const [promptPreviewSlot, setPromptPreviewSlot] = useState<DOMRect | null>(null);
  const [promptPreviewSlotElement, setPromptPreviewSlotElement] = useState<HTMLDivElement | null>(
    null,
  );
  const handlePromptPreviewSlotChange = useCallback((next: DOMRect | null) => {
    setPromptPreviewSlot((current) =>
      current?.x === next?.x &&
      current?.y === next?.y &&
      current?.width === next?.width &&
      current?.height === next?.height
        ? current
        : next,
    );
  }, []);
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
      sourceDeckCard: fixtures.sourceCard,
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
  const previewCard = useMemo(
    () =>
      cardPreview.hoveredCard
        ? {
            ...cardPreview.hoveredCard,
            zoneId: cardPreview.hoveredCard.zoneId ?? "prompt",
          }
        : null,
    [cardPreview.hoveredCard],
  );
  const previewVisible = previewCard !== null && cardPreview.phase !== "hidden";
  const externalPreviewActive = previewCard !== null && cardPreview.phase === "open";
  const usePromptPreviewSlot = promptPreviewSlot !== null;

  const togglePreviewView = () => {
    if (!previewCard) return;
    flushSync(() => setPreviewViewSwitchCardId(previewCard.id));
    const preferences = usePreferencesStore.getState();
    preferences.setInGameCardPreviewStyle(
      preferences.inGameCardPreviewStyle === "printed" ? "rules" : "printed",
    );
  };
  const skipPreviewEnterAnimation =
    cardPreview.phase === "open" &&
    previewCard !== null &&
    previewViewSwitchCardId === previewCard.id;
  const rulesPreview: BoardOverlayPreviewSpec | null =
    previewStyle === "rules" && previewVisible && previewCard
      ? {
          card: previewCard,
          variant: usePromptPreviewSlot ? "hand" : "field",
          phase: cardPreview.phase === "closing" ? "closing" : "open",
          sticky: cardPreview.isSticky,
          showBackFace: cardPreview.showBackFace,
          suppressed: false,
          skipEnterAnimation: skipPreviewEnterAnimation,
          actions: [],
          mousePos: cardPreview.mousePos,
          anchorRect: cardPreview.anchorRect,
          slotRect: promptPreviewSlot,
        }
      : null;

  useKeybindings(
    externalPreviewActive
      ? {
          "toggle-card-view": togglePreviewView,
        }
      : {},
  );

  return createPortal(
    <>
      <div className="pointer-events-none fixed inset-0 z-[9998]">
        <BoardOverlayCanvas
          scene={null}
          stackSpec={EMPTY_STACK}
          onOpenStack={noAction}
          onTargetSpell={noAction}
          onHoverStack={noAction}
          onToggleStack={noAction}
          promptSpec={spec}
          onPromptPreviewSlotChange={handlePromptPreviewSlotChange}
          onHoverCard={(card, options) => {
            if (!card) {
              setPreviewViewSwitchCardId(null);
              cardPreview.handleMouseLeave();
              return;
            }
            if (cardPreview.hoveredCard?.id !== card.id) setPreviewViewSwitchCardId(null);
            cardPreview.handleMouseEnter(card, undefined, {
              ...options,
              useDelay: false,
            });
          }}
          onLongPressCard={(card, rect) =>
            cardPreview.showSticky(
              card,
              rect.left + rect.width / 2,
              rect.top + rect.height / 2,
              rect,
            )
          }
          externalPreviewActive={externalPreviewActive}
          previewSpec={rulesPreview}
          onPreviewPointerEnter={cardPreview.onMouseEnterPreview}
          onPreviewPointerLeave={cardPreview.onMouseLeavePreview}
          onDismissPreview={cardPreview.dismiss}
          onFlipPreview={cardPreview.flipCard}
          onTogglePreviewView={togglePreviewView}
        />
      </div>
      {usePromptPreviewSlot &&
        createPortal(
          <div
            ref={setPromptPreviewSlotElement}
            className="pointer-events-none fixed z-[9999]"
            style={{
              left: promptPreviewSlot.x,
              top: promptPreviewSlot.y,
              width: promptPreviewSlot.width,
              height: promptPreviewSlot.height,
            }}
          />,
          document.body,
        )}
      {previewStyle === "printed" &&
        previewVisible &&
        (!usePromptPreviewSlot || promptPreviewSlotElement) && (
          <HoverCardPreview
            preview={cardPreview}
            skipEnterAnimation={usePromptPreviewSlot || skipPreviewEnterAnimation}
            pinned={usePromptPreviewSlot}
            slot={usePromptPreviewSlot ? promptPreviewSlotElement : null}
            onToggleView={togglePreviewView}
          />
        )}
    </>,
    document.body,
  );
}

function previewInput(preview: DevDialogPreview, fixtures: DevDialogFixtures): PromptInput {
  const { cards, me, targetPlayer, presentation } = fixtures;
  switch (preview) {
    case "choose-boolean":
      return {
        type: "chooseBoolean",
        presentation,
        confirmLabel: "Create the token",
        denyLabel: "Decline",
      };
    case "choose-color":
      return {
        type: "chooseColor",
        presentation,
        validColors: ["W", "U", "B", "R", "G"],
        amount: 1,
        repeatAllowed: false,
      };
    case "choose-colors":
      return {
        type: "chooseColor",
        presentation,
        validColors: ["W", "U", "B", "R", "G"],
        amount: 3,
        repeatAllowed: true,
      };
    case "choose-number-buttons":
      return { type: "chooseNumber", presentation, min: 0, max: 5 };
    case "choose-number-input":
      return { type: "chooseNumber", presentation, min: 0, max: 99 };
    case "choose-cards":
      return { type: "chooseCards", presentation, cards, min: 1, max: 2 };
    case "reveal-cards":
      return {
        type: "revealCards",
        presentation,
        cards,
        zone: "battlefield",
        ownerPlayerId: me.id,
      };
    case "scry":
      return {
        type: "scry",
        presentation: { ...presentation, title: "Scry 3" },
        cards,
        zones: ["libraryTop", "libraryBottom", "graveyard"],
      };
    case "reorder":
      return {
        type: "reorder",
        presentation: { ...presentation, title: "Choose the trigger order" },
        items: cards.map((card, index) => ({
          id: card.id,
          card,
          oracle: `Triggered ability ${index + 1}`,
        })),
      };
    case "choose-selection":
      return {
        type: "chooseFromSelection",
        presentation,
        minTotal: 1,
        maxTotal: 3,
        options: [
          { label: "Draw a card", weight: 1, canRepeat: false },
          { label: "Create a 1/1 Soldier token", weight: 1, canRepeat: true },
          { label: "Gain 3 life", weight: 1, canRepeat: false },
          { label: "Return a permanent to its owner's hand", weight: 2, canRepeat: false },
          { label: "Add {G}{G}", weight: 1, canRepeat: false },
          { label: "Put two +1/+1 counters on a creature", weight: 2, canRepeat: false },
        ],
      };
    case "assign-combat-damage":
      return {
        type: "chooseCombatDamageAssignment",
        attackerId: cards[0]!.id,
        blockerIds: [cards[1]!.id, cards[2]!.id],
        defenderId: targetPlayer.id,
        totalDamage: 7,
        attackerHasDeathtouch: false,
      };
    case "damage-order":
      return {
        type: "chooseDamageAssignmentOrder",
        attackerId: cards[0]!.id,
        blockerIds: [cards[1]!.id, cards[2]!.id],
        blockerCards: cards.slice(1, 3),
      };
    case "dice-roll":
      return {
        type: "diceRolled",
        presentation,
        sides: 20,
        rolls: [{ naturalResults: [17], finalResults: [17], ignoredRolls: [], highlighted: false }],
      };
    case "dice-roll-contest":
      return {
        type: "diceRolled",
        presentation: { ...presentation, title: "Choose the starting player" },
        sides: 20,
        rolls: [
          {
            label: me.name,
            playerId: me.id,
            naturalResults: [14],
            finalResults: [14],
            ignoredRolls: [],
            highlighted: true,
          },
          {
            label: targetPlayer.name,
            playerId: targetPlayer.id,
            naturalResults: [9],
            finalResults: [9],
            ignoredRolls: [],
            highlighted: false,
          },
        ],
      };
    case "game-over":
      return { type: "gameOver" } as PromptInput;
  }
  throw new Error(`Unsupported prompt preview: ${preview}`);
}
