import { useEffect, useMemo, useRef, useState } from "react";
import { Application } from "pixi.js";
import { createPortal } from "react-dom";

import type { PromptActionSpec } from "@/components/game/game.types";
import { destroyPixiApp, installPixiPatches } from "@/pixi/pixiPatches";
import { PromptLayer } from "@/pixi/prompts/PromptLayer";
import type { PromptOverlaySpec } from "@/pixi/prompts/prompt.types";
import type { Prompt, PromptInput } from "@/protocol";

import type { DevDialogPreview } from "../promptDialogPreviews";
import type { DevDialogFixtures } from "./useDevDialogFixtures";

installPixiPatches();

interface PromptModalPreviewProps {
  preview: DevDialogPreview;
  fixtures: DevDialogFixtures;
  onClose: () => void;
}

const noAction = (): void => undefined;

export function PromptModalPreview({ preview, fixtures, onClose }: PromptModalPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<PromptLayer | null>(null);
  const [damageOrder, setDamageOrder] = useState<string[]>([]);
  const input = useMemo(() => previewInput(preview, fixtures), [preview, fixtures]);
  const prompt = useMemo<Prompt>(() => ({ input }) as Prompt, [input]);
  const blockerCards = fixtures.cards.slice(1, 3);

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

  const spec: PromptOverlaySpec = {
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
  const specRef = useRef(spec);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.style.pointerEvents = "none";
    let active = true;
    const app = new Application();
    void app
      .init({
        canvas,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.max(2, window.devicePixelRatio || 1),
        resizeTo: window,
      })
      .then(() => {
        if (!active) {
          destroyPixiApp(app);
          return;
        }
        app.stage.eventMode = "static";
        canvas.style.pointerEvents = "auto";
        const layer = new PromptLayer(app);
        layerRef.current = layer;
        layer.setViewport(app.screen.width, app.screen.height);
        layer.setSpec(specRef.current);
      })
      .catch(() => {
        if (active) specRef.current.onHideModal();
      });
    return () => {
      active = false;
      layerRef.current?.destroy();
      layerRef.current = null;
      destroyPixiApp(app);
    };
  }, []);

  useEffect(() => {
    specRef.current = spec;
    layerRef.current?.setSpec(spec);
  });

  return createPortal(
    <canvas ref={canvasRef} className="fixed inset-0 z-[10000] h-full w-full" />,
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
