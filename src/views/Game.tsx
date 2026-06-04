import { useGameStore } from "@/stores/useGameStore";
import { asDeckCard } from "@/lib/decks";
import { useGameUIStore } from "@/stores/useGameUIStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useAutoResolvePrompt } from "@/components/game/prompts/useAutoResolvePrompt";
import { useShallow } from "zustand/react/shallow";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GameCard, Player, StackObject, ActivatableAbilityInfo } from "@/types/manabrew";
import { Card } from "@/components/game/Card";
import { GameModals } from "@/components/game/GameModals";
import { GameOverScreen } from "@/components/game/GameOverScreen";
import { GameLoadingScreen } from "@/components/game/GameLoadingScreen";
import { FullscreenToggle } from "@/components/game/FullscreenToggle";
import { ManualTabletopControls } from "@/components/game/ManualTabletopControls";
import { MainActionOverlay, RightActionPanel } from "@/components/game/panels";
import { StackDisplay } from "@/components/game/panels/StackDisplay";
import { useCastingState } from "@/hooks/useCastingState";
import { PixiArrowsCanvas } from "@/pixi/PixiArrowsCanvas";
import type { PixiGameScene } from "@/pixi/PixiGameScene";
import { buildArrowSpecs } from "@/components/game/arrowSpecs";
import { buildPointerSpecs } from "@/components/game/pointerSpecs";
import { ANY_COLOR_LETTERS } from "@/components/game/manaUtils";
import { PlayModePicker } from "@/components/game/PlayModePicker";
import { HAND_CARD_BASES } from "@/components/game/game.styles";
import { useHandScale } from "@/hooks/useHandScale";
import { useFlashQueue } from "@/hooks/useFlashQueue";
import { useHandDrag } from "@/hooks/useHandDrag";
import { useCardPreview } from "@/hooks/useCardPreview";
import { useMulliganSelection } from "@/hooks/useMulliganSelection";
import { HoverCardPreview } from "@/components/game/HoverCardPreview";
import { usePromptEffects } from "@/hooks/usePromptEffects";
import { useCombatState } from "@/hooks/useCombatState";
import { useGameEventListeners } from "@/hooks/useGameEventListeners";
import { useGamePrefetch } from "@/hooks/useGamePrefetch";
import { GameBoard } from "@/components/game/GameBoard";
import { withAlpha } from "@/themes/gameTheme";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { useLimitedStore } from "@/stores/useLimitedStore";
import { tryConsumeGauntletMatch } from "@/lib/gauntletReturn";
import { PromptType, intentPrefersArrow } from "@/types/promptType";
import { TargetingCursor } from "@/components/game/TargetingCursor";
import { OPPONENT_SEATS } from "@/components/game/game.types";
import { useStackUIStore } from "@/stores/useStackUIStore";
import { useGameDevStore, DEBUG_KEYWORD_CARD_ID } from "@/stores/useGameDevStore";
import { stackObjectToCardStub } from "@/components/game/game.utils";
import { applyManualTabletopAction, getSelectedGameRuntime } from "@/game";
import type { HandActionOption } from "@/stores/useGameUIStore";
import type { PlacementGhost } from "@/components/game/game.types";
import type { GameRuntime, ManualTabletopApi } from "@/game";

/** Prompt types where hover card preview is allowed (no modal overlay). */
const HOVER_ALLOWED_PROMPTS = new Set<PromptType>([
  PromptType.ChooseAction,
  PromptType.ChooseAttackers,
  PromptType.ChooseBlockers,
  PromptType.ChooseTargetPlayer,
  PromptType.ChooseTargetCard,
  PromptType.ChooseTargetAny,
  PromptType.ChooseTargetCardFromZone,
  PromptType.ChooseTargetSpell,
  PromptType.PayManaCost,
  PromptType.GameOver,
]);

function isManualTabletopApi(
  runtime: GameRuntime,
): runtime is GameRuntime & { api: ManualTabletopApi } {
  return runtime.capabilities.manualTabletop && "applyManualAction" in runtime.api;
}

function buildDebugKeywordCard(controllerId: string, name: string, keywords: string[]): GameCard {
  return {
    id: DEBUG_KEYWORD_CARD_ID,
    name: name.trim() || "Raging Goblin",
    setCode: "",
    cardNumber: "",
    color: "R",
    colorIdentity: ["R"],
    manaCost: "{R}",
    cmc: 1,
    types: ["Creature"],
    subtypes: [],
    supertypes: [],
    power: "1",
    toughness: "1",
    text: "Dev debug card.",
    isPlayable: false,
    isSelected: false,
    isChoosable: false,
    controllerId,
    ownerId: controllerId,
    zoneId: "dev-zone",
    keywords,
  };
}

interface GameProps {
  /** When provided, redirect here instead of /lobby when the game ends. */
  exitTo?: string;
}

export default function Game({ exitTo }: GameProps = {}) {
  useAutoResolvePrompt();
  const gameView = useGameStore((s) => s.gameView);
  const currentPrompt = useGameStore((s) => s.currentPrompt);
  const isGameActive = useGameStore((s) => s.isGameActive);
  const isPrefetchingCards = useGameStore((s) => s.isPrefetchingCards);
  const isWaitingForResponse = useGameStore((s) => s.isWaitingForResponse);
  const gameLog = useGameStore((s) => s.gameLog);
  const snapshots = useGameStore((s) => s.snapshots);
  const debugInfo = useGameStore((s) => s.debugInfo);
  const isMultiplayer = useGameStore((s) => s.isMultiplayer);
  const isHost = useGameStore((s) => s.isHost);
  const selectedRuntime = getSelectedGameRuntime();
  const manualApi = isManualTabletopApi(selectedRuntime) ? selectedRuntime.api : null;
  const {
    passPriority,
    castSpell,
    declareAttackers,
    declareBlockers,
    targetPlayer,
    targetCard,
    targetAny,
    mulliganDecision,
    mulliganPutBackDecision,
    tapLand,
    untapLand,
    activateAbility,
    scryDecision,
    surveilDecision,
    digDecision,
    discardDecision,
    targetSpell,
    modeDecision,
    optionalTriggerDecision,
    revealCardsAcknowledged,
    payCostToPreventEffectDecision,
    colorDecision,
    chooseCardsDecision,
    typeDecision,
    numberDecision,
    cardNameDecision,
    respond,
    payCombatCost,
    declineCombatCost,
    payManaCost,
    autoManaCost,
    cancelManaCost,
    delveDecision,
    convokeDecision,
    improviseDecision,
    manaComboDecision,
    exploreDecision,
    exertDecision,
    enlistDecision,
    reorderLibraryDecision,
    assistDecision,
    diceRolledAcknowledged,
    firstPlayerRollAcknowledged,
    rollToIgnoreDecision,
    rollToSwapDecision,
    rollToModifyDecision,
    diceToRerollDecision,
    rollSwapValueDecision,
    concede,
    endGame,
    restoreSnapshot,
    gameDecks,
  } = useGameStore(
    useShallow((s) => ({
      passPriority: s.passPriority,
      castSpell: s.castSpell,
      declareAttackers: s.declareAttackers,
      declareBlockers: s.declareBlockers,
      targetPlayer: s.targetPlayer,
      targetCard: s.targetCard,
      targetAny: s.targetAny,
      mulliganDecision: s.mulliganDecision,
      mulliganPutBackDecision: s.mulliganPutBackDecision,
      tapLand: s.tapLand,
      untapLand: s.untapLand,
      activateAbility: s.activateAbility,
      scryDecision: s.scryDecision,
      surveilDecision: s.surveilDecision,
      digDecision: s.digDecision,
      discardDecision: s.discardDecision,
      targetSpell: s.targetSpell,
      modeDecision: s.modeDecision,
      revealCardsAcknowledged: s.revealCardsAcknowledged,
      payCostToPreventEffectDecision: s.payCostToPreventEffectDecision,
      optionalTriggerDecision: s.optionalTriggerDecision,
      colorDecision: s.colorDecision,
      chooseCardsDecision: s.chooseCardsDecision,
      typeDecision: s.typeDecision,
      numberDecision: s.numberDecision,
      cardNameDecision: s.cardNameDecision,
      respond: s.respond,
      payCombatCost: s.payCombatCost,
      declineCombatCost: s.declineCombatCost,
      payManaCost: s.payManaCost,
      autoManaCost: s.autoManaCost,
      cancelManaCost: s.cancelManaCost,
      delveDecision: s.delveDecision,
      convokeDecision: s.convokeDecision,
      improviseDecision: s.improviseDecision,
      manaComboDecision: s.manaComboDecision,
      exploreDecision: s.exploreDecision,
      exertDecision: s.exertDecision,
      enlistDecision: s.enlistDecision,
      reorderLibraryDecision: s.reorderLibraryDecision,
      assistDecision: s.assistDecision,
      diceRolledAcknowledged: s.diceRolledAcknowledged,
      firstPlayerRollAcknowledged: s.firstPlayerRollAcknowledged,
      rollToIgnoreDecision: s.rollToIgnoreDecision,
      rollToSwapDecision: s.rollToSwapDecision,
      rollToModifyDecision: s.rollToModifyDecision,
      diceToRerollDecision: s.diceToRerollDecision,
      rollSwapValueDecision: s.rollSwapValueDecision,
      concede: s.concede,
      endGame: s.endGame,
      restoreSnapshot: s.restoreSnapshot,
      gameDecks: s.gameDecks,
    })),
  );
  const flashDurationMs = usePreferencesStore((s) => s.flashDurationMs);
  const zonePanelOrder = usePreferencesStore((s) => s.zonePanelOrder);
  const handSize = usePreferencesStore((s) => s.handSize);
  const vScale = useHandScale();
  const ghostCardW = Math.round(HAND_CARD_BASES[handSize].cardW * vScale);
  const ghostCardH = Math.round(HAND_CARD_BASES[handSize].cardH * vScale);
  const themeColors = useTheme().gameTheme;
  const location = useLocation();
  const devExtraOpponents =
    (location.state as { devExtraOpponents?: number } | null)?.devExtraOpponents ?? 0;
  const containerRef = useRef<HTMLDivElement>(null);
  // Ref populated by PixiGameCanvas once its scene is live. Used by the
  // full-board PixiArrowsCanvas to read sprite positions across canvases.
  const pixiSceneRef = useRef<PixiGameScene | null>(null);

  // Per-opponent Pixi scene refs — one `MutableRefObject` per player id.
  // Each opponent's PixiGameCanvas writes its live scene into its ref so
  // the arrow layer can read opponent sprite positions without a DOM
  // fallback. The dispenser lazily creates the ref object the first time
  // a given opponent asks for it so the identity is stable across
  // re-renders (React requires refs not to flicker between invocations).
  const opponentSceneRefsRef = useRef<Map<string, React.MutableRefObject<PixiGameScene | null>>>(
    new Map(),
  );
  const getOpponentPixiSceneRef = useCallback(
    (playerId: string): React.MutableRefObject<PixiGameScene | null> => {
      let ref = opponentSceneRefsRef.current.get(playerId);
      if (!ref) {
        ref = { current: null };
        opponentSceneRefsRef.current.set(playerId, ref);
      }
      return ref;
    },
    [],
  );

  // Rect of the StackDisplay panel in canvas-local coords, or null when the
  // stack isn't rendered. Fed to the Pixi scene as an external blocker so
  // battlefield cards beneath it relocate to a free grid cell (keeping them
  // reachable for targeting). A rAF loop keeps up with the CSS `right` /
  // `left` transitions the stack animates on hover and action-panel toggles.
  const [stackBlockerRect, setStackBlockerRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  useEffect(() => {
    let raf = 0;
    let lastKey = "";
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const scene = pixiSceneRef.current;
      const panel = document.querySelector<HTMLElement>("[data-stack-panel]");
      if (!scene || !panel) {
        if (lastKey !== "") {
          lastKey = "";
          setStackBlockerRect(null);
        }
        return;
      }
      const canvasRect = scene.canvasElement.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const rect = {
        x: Math.round(panelRect.left - canvasRect.left),
        y: Math.round(panelRect.top - canvasRect.top),
        width: Math.round(panelRect.width),
        height: Math.round(panelRect.height),
      };
      const key = `${rect.x},${rect.y},${rect.width},${rect.height}`;
      if (key === lastKey) return;
      lastKey = key;
      setStackBlockerRect(rect);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const activePrompt = manualApi || isWaitingForResponse ? null : currentPrompt;
  const promptType = activePrompt?.type;

  // When the engine asks the player to pick cards to put on the bottom
  // of the library we drive that decision from the real in-game hand
  // instead of a separate modal. The hook bundles the selection state,
  // toggle, reset-on-prompt-change, and the put-back dispatch.
  const mulliganPutBack = useMulliganSelection(activePrompt, mulliganPutBackDecision);

  const casting = useCastingState({
    currentPrompt: activePrompt,
    targetCard,
    targetPlayer,
    targetAny,
  });

  // UI state from Zustand store (modals, panels)
  const {
    abilityPicker: abilityPickerState,
    playModePicker,
    viewingZone,
    isActionPanelCollapsed,
    closeAbilityPicker,
    openPlayModePicker,
    closePlayModePicker,
    openZoneViewer,
    closeZoneViewer,
    toggleActionPanel,
  } = useGameUIStore(
    useShallow((s) => ({
      abilityPicker: s.abilityPicker,
      playModePicker: s.playModePicker,
      viewingZone: s.viewingZone,
      isActionPanelCollapsed: s.isActionPanelCollapsed,
      closeAbilityPicker: s.closeAbilityPicker,
      openPlayModePicker: s.openPlayModePicker,
      closePlayModePicker: s.closePlayModePicker,
      openZoneViewer: s.openZoneViewer,
      closeZoneViewer: s.closeZoneViewer,
      toggleActionPanel: s.toggleActionPanel,
    })),
  );

  /** Map an ActivatableAbilityInfo to a HandActionOption. */
  const toAbilityOption = (a: {
    cardId: string;
    abilityIndex: number;
    description: string;
    isManaAbility: boolean;
    cost?: string;
  }): HandActionOption => ({
    kind: "ability" as const,
    cardId: a.cardId,
    abilityIndex: a.abilityIndex,
    label: a.description,
    isManaAbility: a.isManaAbility,
    cost: a.cost,
  });

  const castOptionsByCardId = useMemo(() => {
    const map = new Map<string, HandActionOption[]>();
    for (const o of activePrompt?.playableOptions ?? []) {
      const arr = map.get(o.cardId) ?? [];
      arr.push({ kind: "cast" as const, cardId: o.cardId, mode: o.mode, label: o.modeLabel });
      map.set(o.cardId, arr);
    }
    return map;
  }, [activePrompt?.playableOptions]);

  const abilitiesByCardId = useMemo(() => {
    const map = new Map<string, HandActionOption[]>();
    for (const a of activePrompt?.activatableAbilityIds ?? []) {
      const arr = map.get(a.cardId) ?? [];
      arr.push(toAbilityOption(a));
      map.set(a.cardId, arr);
    }
    return map;
  }, [activePrompt?.activatableAbilityIds]);

  const manaAbilitiesByCardId = useMemo(() => {
    const map = new Map<string, HandActionOption[]>();
    const rawOptions = activePrompt?.manaAbilityOptions ?? [];
    if (rawOptions.length === 0) return map;
    const byCard = new Map<string, ActivatableAbilityInfo[]>();
    for (const ab of rawOptions) {
      const arr = byCard.get(ab.cardId) ?? [];
      arr.push(ab);
      byCard.set(ab.cardId, arr);
    }
    for (const [cardId, abilities] of byCard) {
      const expanded: ActivatableAbilityInfo[] = [];
      for (const ab of abilities) {
        const desc = ab.description.toLowerCase();
        const matches = ab.description.matchAll(/\{([WUBRGC])\}/g);
        const letters = Array.from(matches, (m) => m[1]);
        const isAnyColor =
          desc.includes("any color") ||
          desc.includes("any one color") ||
          desc.includes("mana of any color");
        if (letters.length > 1) {
          letters.forEach((letter) => expanded.push({ ...ab, description: `Add {${letter}}` }));
        } else if (letters.length === 1) {
          expanded.push(ab);
        } else if (isAnyColor) {
          ANY_COLOR_LETTERS.forEach((letter) =>
            expanded.push({ ...ab, description: `Add {${letter}}` }),
          );
        } else {
          expanded.push(ab);
        }
      }
      map.set(cardId, expanded.map(toAbilityOption));
    }
    return map;
  }, [activePrompt?.manaAbilityOptions]);

  const tappableLandIdSet = useMemo(
    () => new Set(activePrompt?.tappableLandIds ?? []),
    [activePrompt?.tappableLandIds],
  );

  const applyManualAction = useCallback(
    async (action: Parameters<typeof applyManualTabletopAction>[1]) => {
      if (!manualApi) return;
      const nextView = await applyManualTabletopAction(manualApi, action);
      if (nextView) useGameStore.getState().updateGameView(nextView);
    },
    [manualApi],
  );

  const getManualCardActions = useCallback(
    (card: GameCard): HandActionOption[] => {
      if (!manualApi) return [];
      const humanPlayerId = gameView?.players[0]?.id;
      const ownsHumanZone = card.controllerId === humanPlayerId || card.ownerId === humanPlayerId;
      const graveyardZone = ownsHumanZone ? "graveyard" : "opponentGraveyard";
      const exileZone = ownsHumanZone ? "exile" : "opponentExile";
      const commandZone = ownsHumanZone ? "command" : "opponentCommand";
      const move = (label: string, toZoneId: string): HandActionOption => ({
        kind: "manual-move",
        cardId: card.id,
        label,
        toZoneId,
      });

      if (card.zoneId === "battlefield") {
        return [
          {
            kind: "manual-tap",
            cardId: card.id,
            label: card.tapped ? "Untap" : "Tap",
            tapped: !card.tapped,
          },
          move("Move to Hand", "hand"),
          move("Move to Graveyard", graveyardZone),
          move("Move to Exile", exileZone),
          move("Move to Command", commandZone),
        ];
      }

      return [
        move("Put onto Battlefield", "battlefield"),
        move("Move to Graveyard", graveyardZone),
        move("Move to Exile", exileZone),
        move("Move to Command", commandZone),
      ];
    },
    [manualApi, gameView?.players],
  );

  const getHandActionOptions = useCallback(
    (card: GameCard): HandActionOption[] =>
      manualApi
        ? getManualCardActions(card)
        : [...(castOptionsByCardId.get(card.id) ?? []), ...(abilitiesByCardId.get(card.id) ?? [])],
    [manualApi, getManualCardActions, castOptionsByCardId, abilitiesByCardId],
  );

  const getBattlefieldAbilityOptions = useCallback(
    (card: GameCard): HandActionOption[] => abilitiesByCardId.get(card.id) ?? [],
    [abilitiesByCardId],
  );

  /** All available actions for a card (cast + activated + mana abilities). */
  const getCardActions = useCallback(
    (card: GameCard): HandActionOption[] => {
      if (manualApi) return getManualCardActions(card);
      if (promptType === PromptType.PayManaCost) {
        return manaAbilitiesByCardId.get(card.id) ?? [];
      }
      if (promptType !== PromptType.ChooseAction) return [];

      const abilities = [...(abilitiesByCardId.get(card.id) ?? [])];
      const manaAbilities = manaAbilitiesByCardId.get(card.id) ?? [];
      const isLandTappable = tappableLandIdSet.has(card.id) && card.types?.includes("Land");

      if (isLandTappable && manaAbilities.length > 0) {
        // Use explicit mana abilities emitted by the engine instead of inventing a generic land tap action.
        abilities.unshift(...manaAbilities);
      }
      return [...(castOptionsByCardId.get(card.id) ?? []), ...abilities];
    },
    [
      manualApi,
      getManualCardActions,
      promptType,
      castOptionsByCardId,
      abilitiesByCardId,
      manaAbilitiesByCardId,
      tappableLandIdSet,
    ],
  );

  // Wraps castSpell: if a card has multiple play modes, show picker first
  const handleCastSpell = (cardId: string) => {
    const options = activePrompt?.playableOptions?.filter((o) => o.cardId === cardId);
    if (options && options.length > 1) {
      const gc =
        gameView?.myHand.find((c) => c.id === cardId) ??
        gameView?.graveyard.find((c) => c.id === cardId) ??
        gameView?.exile.find((c) => c.id === cardId);
      if (!gc) throw new Error(`No game card to cast: ${cardId}`);
      const card = asDeckCard(gameDecks[gc.ownerId], gc);
      openPlayModePicker({ cardId, card, options });
    } else if (options && options.length === 1) {
      castSpell(cardId, options[0].mode);
    } else {
      castSpell(cardId);
    }
  };

  const handleHandCardAction = (card: GameCard, e?: React.MouseEvent) => {
    if (manualApi) {
      preview.showSticky(card, e?.clientX, e?.clientY);
      return;
    }
    const actions = getHandActionOptions(card);
    if (actions.length === 0) {
      if (card.isPlayable) {
        handleCastSpell(card.id);
      }
      return;
    }

    if (actions.length === 1) {
      const [action] = actions;
      if (action.kind === "cast") {
        castSpell(card.id, action.mode);
      } else if (action.abilityIndex != null) {
        activateAbility(card.id, action.abilityIndex);
      }
      return;
    }

    // Multiple actions — show the interactive preview without sending anything to the engine
    preview.showSticky(card, e?.clientX, e?.clientY);
  };

  const handleHandCardDragStart = (card: GameCard, e: React.MouseEvent) => {
    if (manualApi) {
      preview.showSticky(card, e.clientX, e.clientY);
      return;
    }
    const actions = getHandActionOptions(card);
    if (actions.length > 1 || actions.some((action) => action.kind === "ability")) {
      handleHandCardAction(card, e);
      return;
    }
    startHandCardDrag(card, e);
  };

  const handleBattlefieldCardAction = (card: GameCard, e?: React.MouseEvent) => {
    const abilities = getBattlefieldAbilityOptions(card);
    if (abilities.length === 0) return false;

    if (abilities.length === 1) {
      const ability = abilities[0];
      if (ability.kind === "ability" && ability.abilityIndex != null) {
        activateAbility(card.id, ability.abilityIndex);
        return true;
      }
      return false;
    }

    // Multiple abilities — show the interactive preview without sending anything
    preview.showSticky(card, e?.clientX, e?.clientY);
    return true;
  };

  // Combat state + battlefield/targeting click handlers
  const {
    pendingAttackers,
    pendingAttacker,
    attackDefenderId,
    blockAssignments,
    multipleAttackDefenders,
    awaitingAttackTarget,
    playerIsTargetable,
    cardIsAttackTarget,
    handleTargetPlayer,
    handleBattlefieldClick,
    handleAttackerClick,
    selectAllAttackersForPick,
    cancelAttackTargetPick,
  } = useCombatState({
    promptType,
    targetCard: casting.wrappedTargetCard,
    targetAny: casting.wrappedTargetAny,
    targetPlayer: casting.wrappedTargetPlayer,
    declareAttackers,
    currentPrompt: activePrompt,
  });
  const selectedAttackDefender = activePrompt?.possibleDefenderIds?.find(
    (defender) => defender.id === attackDefenderId,
  );

  // Zone viewer helpers (wrap store actions)
  function openZone(title: string, cards: GameCard[], onClickCard?: (cardId: string) => void) {
    openZoneViewer({ title, cards, onClickCard });
  }
  function openManualZone(title: string, cards: GameCard[]) {
    openZoneViewer({
      title,
      cards: cards.map((card) => ({ ...card, isPlayable: true })),
      onClickCard: (cardId) => {
        const card = cards.find((candidate) => candidate.id === cardId);
        closeZoneViewer();
        if (!card) return;
        void applyManualAction({
          type: "moveCard",
          cardId,
          fromZoneId: card.zoneId,
          toZoneId: "battlefield",
        });
      },
    });
  }
  function closeZone() {
    closeZoneViewer();
  }
  function openZoneAndCast(
    title: string,
    cards: GameCard[],
    onClickCard: (cardId: string) => void,
  ) {
    openZoneViewer({
      title,
      cards,
      onClickCard: (cardId) => {
        closeZoneViewer();
        onClickCard(cardId);
      },
    });
  }

  // Land tap/untap handler — shows interactive preview for multi-ability lands
  const handleTapLand = (card: GameCard) => {
    if (promptType === PromptType.PayManaCost) {
      const manaAbilities = (activePrompt?.manaAbilityOptions ?? [])
        .filter((a) => a.cardId === card.id)
        .map((ability) => ({
          kind: "ability" as const,
          cardId: ability.cardId,
          abilityIndex: ability.abilityIndex,
          label: ability.description,
          isManaAbility: true,
          cost: ability.cost,
        }));

      if (manaAbilities.length > 1) {
        preview.showSticky(card);
        return;
      }
      if (manaAbilities.length === 1) {
        tapLand(card.id, manaAbilities[0].abilityIndex);
        return;
      }
      tapLand(card.id);
      return;
    }

    if (promptType !== PromptType.ChooseAction) {
      tapLand(card.id);
      return;
    }

    const abilities = (activePrompt?.activatableAbilityIds ?? [])
      .filter((a) => a.cardId === card.id)
      .map((ability) => ({
        kind: "ability" as const,
        cardId: ability.cardId,
        abilityIndex: ability.abilityIndex,
        label: ability.description,
        isManaAbility: ability.isManaAbility,
        cost: ability.cost,
      }));
    const manaAbilities = (activePrompt?.manaAbilityOptions ?? []).filter(
      (a) => a.cardId === card.id,
    );
    const isManaSource = (activePrompt?.tappableLandIds ?? []).includes(card.id);
    const hasManaAbility = isManaSource && card.types.includes("Land");

    // Multiple mana abilities (dual land) — show interactive preview for color choice
    if (manaAbilities.length > 1) {
      preview.showSticky(card);
      return;
    }
    // Single mana ability — tap directly with that ability index
    if (manaAbilities.length === 1 && abilities.length === 0) {
      tapLand(card.id, manaAbilities[0].abilityIndex);
      return;
    }

    // Multiple options — show interactive preview
    if (abilities.length > 1 || (abilities.length >= 1 && hasManaAbility)) {
      preview.showSticky(card);
    } else if (abilities.length === 1) {
      if (abilities[0].abilityIndex != null) {
        activateAbility(card.id, abilities[0].abilityIndex);
      }
    } else {
      tapLand(card.id);
    }
  };

  const handleUntapLand = (card: GameCard) => {
    untapLand(card.id);
  };

  // Queues for tapping/untapping multiple selected lands across prompt cycles
  const pendingTapQueueRef = useRef<string[]>([]);
  const pendingUntapQueueRef = useRef<string[]>([]);

  /** Start a batch land action: execute the first immediately, queue the rest. */
  const startBatchLandAction = (
    cardIds: string[],
    queueRef: React.MutableRefObject<string[]>,
    action: (id: string) => void,
  ) => {
    if (cardIds.length === 0) return;
    const [first, ...rest] = cardIds;
    queueRef.current = rest;
    action(first);
  };

  const handleTapLands = (cardIds: string[]) =>
    startBatchLandAction(cardIds, pendingTapQueueRef, tapLand);

  const handleUntapLands = (cardIds: string[]) =>
    startBatchLandAction(cardIds, pendingUntapQueueRef, untapLand);

  /** Drain the next item from a land action queue if still valid. Returns true if an action was taken. */
  const drainQueue = (
    queueRef: React.MutableRefObject<string[]>,
    validIds: string[],
    action: (id: string) => void,
  ): boolean => {
    const queue = queueRef.current;
    if (queue.length === 0) return false;
    const valid = new Set(validIds);
    const nextId = queue.find((id) => valid.has(id));
    if (!nextId) {
      queueRef.current = [];
      return false;
    }
    queueRef.current = queue.filter((id) => id !== nextId);
    action(nextId);
    return true;
  };

  // Process pending tap/untap queues when a new prompt arrives
  useEffect(() => {
    if (isWaitingForResponse) return;
    if (!promptType) return;
    if (promptType !== PromptType.ChooseAction && promptType !== PromptType.PayManaCost) {
      pendingTapQueueRef.current = [];
      pendingUntapQueueRef.current = [];
      return;
    }
    if (drainQueue(pendingTapQueueRef, activePrompt?.tappableLandIds ?? [], tapLand)) return;
    drainQueue(pendingUntapQueueRef, activePrompt?.untappableLandIds ?? [], untapLand);
  }, [activePrompt, isWaitingForResponse, promptType, tapLand, untapLand]);

  // Prompt-driven effects: auto-pass, passUntilEot, library peek, zone target, spell stack
  const _earlyMyPlayerId =
    gameView?.players?.find((p) => p.isHuman)?.id ?? gameView?.players?.[0]?.id ?? "";
  const {
    isAutoPassing,
    isPassingUntilEot,
    unifiedPass,
    activatePassUntilEot,
    libraryPeekModal,
    setLibraryPeekModal,
    zoneTargetSelector,
    dismissZoneTarget,
    reopenZoneTarget,
    spellStackModalOpen,
    setSpellStackModalOpen,
  } = usePromptEffects({
    currentPrompt: activePrompt,
    isWaitingForResponse,
    passPriority,
    myPlayerId: _earlyMyPlayerId,
    turn: gameView?.turn ?? 0,
    stackLength: gameView?.stack?.length ?? 0,
  });

  const unifiedPassRef = useRef(unifiedPass);
  unifiedPassRef.current = unifiedPass;
  const activatePassUntilEotRef = useRef(activatePassUntilEot);
  activatePassUntilEotRef.current = activatePassUntilEot;
  const payManaPrimaryRef = useRef(() => {});
  payManaPrimaryRef.current = () => {
    if (promptType !== PromptType.PayManaCost) return;
    if (activePrompt?.canConfirmFromPool) {
      payManaCost(false);
    } else {
      autoManaCost();
    }
  };
  const confirmPromptRef = useRef<() => boolean>(() => false);
  confirmPromptRef.current = () => {
    if (promptType === PromptType.PayManaCost) {
      payManaPrimaryRef.current();
      return true;
    }
    if (promptType === PromptType.Mulligan) {
      mulliganDecision(true);
      return true;
    }
    if (promptType === PromptType.MulliganPutBack) {
      if (!mulliganPutBack.active || mulliganPutBack.selected.size !== mulliganPutBack.count) {
        return false;
      }
      mulliganPutBack.confirm();
      return true;
    }
    if (promptType === PromptType.ChooseAttackers) {
      if (pendingAttackers.length === 0) return false;
      declareAttackers(pendingAttackers, attackDefenderId ?? undefined);
      return true;
    }
    if (promptType === PromptType.ChooseBlockers) {
      if (blockAssignments.length === 0) return false;
      declareBlockers(blockAssignments);
      return true;
    }
    return false;
  };

  const preview = useCardPreview([
    viewingZone,
    zoneTargetSelector,
    libraryPeekModal,
    spellStackModalOpen,
    abilityPickerState,
  ]);

  // Hand drag-to-play
  const battlefieldContainerRef = useRef<HTMLDivElement>(null);
  const { draggingHandCard, ghostPos, isOverBattlefield, startHandCardDrag } = useHandDrag({
    battlefieldContainerRef,
    handDropExclusionPx: Math.round(HAND_CARD_BASES[handSize].containerH * vScale * 0.35),
    onCastSpell: handleCastSpell,
    dismissHover: preview.dismiss,
  });

  const hoveredCardActions = preview.hoveredCard ? getCardActions(preview.hoveredCard) : [];

  /** Handle an action selected from the hover preview. */
  const handlePreviewAction = (action: HandActionOption) => {
    preview.dismiss();
    if (action.kind === "cast") {
      castSpell(action.cardId, action.mode);
    } else if (action.kind === "manual-move" && action.toZoneId) {
      const sourceCard = [
        ...(gameView?.myHand ?? []),
        ...(gameView?.battlefield ?? []),
        ...(gameView?.graveyard ?? []),
        ...(gameView?.exile ?? []),
        ...(gameView?.myCommandZone ?? []),
      ].find((card) => card.id === action.cardId);
      void applyManualAction({
        type: "moveCard",
        cardId: action.cardId,
        fromZoneId: sourceCard?.zoneId ?? "",
        toZoneId: action.toZoneId,
      });
    } else if (action.kind === "manual-tap") {
      void applyManualAction({
        type: "tapCard",
        cardId: action.cardId,
        tapped: action.tapped ?? true,
      });
    } else if (action.abilityIndex != null) {
      if (action.isManaAbility) {
        // Mana abilities use tapLand (ActivateMana) in both ChooseAction and PayManaCost.
        // Extract color from label (e.g. "Add {G}") if present.
        const matches = action.label.match(/\{([WUBRGC])\}/);
        const color = matches ? matches[1] : undefined;
        tapLand(action.cardId, action.abilityIndex, color);
      } else {
        activateAbility(action.cardId, action.abilityIndex);
      }
    }
  };

  // Display flash queue
  const activeFlash = useFlashQueue(flashDurationMs);

  // Debounced priority highlight to avoid rapid border strobing during autopass.
  const [priorityHighlightPlayerId, setPriorityHighlightPlayerId] = useState<string | null>(null);
  useEffect(() => {
    const next = gameView?.priorityPlayerId ?? null;
    if (priorityHighlightPlayerId == null || next == null) {
      setPriorityHighlightPlayerId(next);
      return;
    }
    if (next === priorityHighlightPlayerId) return;
    const timer = setTimeout(() => {
      setPriorityHighlightPlayerId(next);
    }, 160);
    return () => clearTimeout(timer);
  }, [gameView?.priorityPlayerId, priorityHighlightPlayerId]);

  // Set up event listeners on mount
  useGameEventListeners();
  useGamePrefetch();

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.repeat) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (manualApi) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (document.querySelector('[role="dialog"]')) return;
        if (confirmPromptRef.current()) return;
        if (promptType === PromptType.ChooseAction) {
          unifiedPassRef.current();
        }
      } else if (e.code === "F6") {
        e.preventDefault();
        activatePassUntilEotRef.current();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [manualApi, promptType]);

  // Targeting / combat arrows — must be called unconditionally (Rules of Hooks)
  const me = gameView?.players?.find((p) => p.isHuman) ?? gameView?.players?.[0];
  const opponents = useMemo(
    () => gameView?.players?.filter((p) => !p.isHuman) ?? [],
    [gameView?.players],
  );
  const opponent = opponents[0]; // alias for arrows hook + game-over screen

  // Map each player's id → their seat color for stack card glows
  const playerColorMap = useMemo(() => {
    const map = new Map<string, string>();
    if (me) map.set(me.id, themeColors.playerColors.self);
    opponents.forEach((opp, i) => {
      const seat = OPPONENT_SEATS[i] ?? "opponent1";
      map.set(opp.id, themeColors.playerColors[seat]);
    });
    return map;
  }, [me, opponents, themeColors.playerColors]);
  // DEV: pad with simulated opponents to test multi-player layout
  const displayOpponents = [
    ...opponents,
    ...Array.from(
      { length: devExtraOpponents },
      (_, i) =>
        ({
          id: `dev-fake-${i}`,
          name: `Dev Opp ${opponents.length + i + 1}`,
          isHuman: false,
          life: 20,
          poison: 0,
          handCount: 7,
          libraryCount: 40,
          graveyardCount: 0,
          exileCount: 0,
          manaPool: {} as Record<string, number>,
        }) as Player,
    ),
  ];
  // Stabilize attackerIds so useGameArrows' useEffect doesn't re-run every render
  const attackerIds = useMemo(
    () => activePrompt?.attackerIds ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activePrompt?.attackerIds?.join(",")],
  );
  const combatAssignments = useMemo(
    () => gameView?.combatAssignments ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gameView?.combatAssignments?.map((a) => `${a.blockerId}:${a.attackerId}`).join(",")],
  );

  const hoveredStackObjectIdForSpecs = useStackUIStore((s) => s.hoveredStackObjectId);
  // Walk every visible permanent for the locked-in attacker→defender
  // pairs (engine fills `attackingPlayerId` once the attack is committed).
  // This drives the persistent painterly arrow shown all the way through
  // combat, regardless of whose prompt is active.
  const activeAttackers = useMemo(
    () =>
      (gameView?.battlefield ?? [])
        .filter((c) => c.isAttacking && c.attackingPlayerId)
        .map((c) => ({ attackerId: c.id, defenderId: c.attackingPlayerId! })),
    [gameView?.battlefield],
  );

  const battlefieldAttachments = useMemo(
    () =>
      (gameView?.battlefield ?? [])
        .filter((c) => !!c.attachedTo)
        .map((c) => ({ childId: c.id, parentId: c.attachedTo! })),
    [gameView?.battlefield],
  );

  const liveArrowSpecs = useMemo(
    () =>
      buildArrowSpecs({
        promptType,
        attackerIds,
        blockAssignments,
        combatAssignments,
        activeAttackers,
        battlefieldAttachments,
        stack: gameView?.stack ?? [],
        activeStackObjectId: hoveredStackObjectIdForSpecs,
      }),
    [
      promptType,
      attackerIds,
      blockAssignments,
      combatAssignments,
      activeAttackers,
      battlefieldAttachments,
      gameView?.stack,
      hoveredStackObjectIdForSpecs,
    ],
  );

  // Dev-only: append a single force-rendered arrow spec for the type
  // selected in the dev panel. Anchored player → player so it always
  // resolves, even with an empty battlefield.
  const debugArrowType = useGameDevStore((s) => s.debugArrowType);
  const arrowSpecs = useMemo(() => {
    if (!debugArrowType || !me?.id || !opponent?.id) return liveArrowSpecs;
    return [
      ...liveArrowSpecs,
      {
        from: { kind: "player" as const, id: me.id },
        to: { kind: "player" as const, id: opponent.id },
        type: debugArrowType,
      },
    ];
  }, [liveArrowSpecs, debugArrowType, me?.id, opponent?.id]);

  const livePointerSpecs = useMemo(
    () =>
      buildPointerSpecs({
        stack: gameView?.stack ?? [],
        activeStackObjectId: hoveredStackObjectIdForSpecs,
      }),
    [gameView?.stack, hoveredStackObjectIdForSpecs],
  );

  // Dev-only: append a single force-rendered pointer spec for the
  // intent the operator has selected in the dev panel so each glyph can
  // be inspected on the live board without needing a real spell. Acts
  // as a radio (one at a time) so glyphs never stack.
  const debugPointerIntent = useGameDevStore((s) => s.debugPointerIntent);
  const debugBattlefieldKeywords = useGameDevStore((s) => s.debugBattlefieldKeywords);
  const debugCardEnabled = useGameDevStore((s) => s.debugCardEnabled);
  const debugCardName = useGameDevStore((s) => s.debugCardName);
  const pointerSpecs = useMemo(() => {
    if (!debugPointerIntent || !me?.id || !opponent?.id) return livePointerSpecs;
    return [
      ...livePointerSpecs,
      {
        from: { kind: "player" as const, id: me.id },
        to: { kind: "player" as const, id: opponent.id },
        intent: debugPointerIntent,
      },
    ];
  }, [livePointerSpecs, debugPointerIntent, me?.id, opponent?.id]);

  const hoveredStackObjectId = useStackUIStore((s) => s.hoveredStackObjectId);
  const placementGhost = useMemo((): PlacementGhost | null => {
    const stack = gameView?.stack;
    if (!stack || stack.length === 0) return null;
    const active =
      (hoveredStackObjectId ? stack.find((obj) => obj.id === hoveredStackObjectId) : null) ??
      stack[stack.length - 1];
    const hasTargets = (active.targets ?? []).length > 0;
    if (hasTargets) return null;
    if (!active.isPermanentSpell) return null;
    return { stackObjectId: active.id, cardName: active.name, controllerId: active.controllerId };
  }, [gameView?.stack, hoveredStackObjectId]);

  const visibleCardsById = useMemo(() => {
    if (!gameView) return new Map<string, GameCard>();
    const opponentZones = Object.values(gameView.opponentZones);
    const cards: GameCard[] = [
      ...gameView.battlefield,
      ...gameView.myHand,
      ...gameView.graveyard,
      ...gameView.exile,
      ...opponentZones.flatMap((z) => z.graveyard),
      ...opponentZones.flatMap((z) => z.exile),
      ...(gameView.myCommandZone ?? []),
      ...opponentZones.flatMap((z) => z.commandZone),
    ];
    const map = new Map(cards.map((c) => [c.id, c]));
    if (debugCardEnabled && me?.id) {
      map.set(
        DEBUG_KEYWORD_CARD_ID,
        buildDebugKeywordCard(me.id, debugCardName, debugBattlefieldKeywords),
      );
    }
    return map;
  }, [gameView, debugCardEnabled, debugCardName, debugBattlefieldKeywords, me?.id]);

  const stackCardsBySourceId = useMemo(() => {
    const byId = new Map<string, GameCard>();
    for (const s of gameView?.stack ?? []) {
      if (byId.has(s.sourceId)) continue;
      byId.set(s.sourceId, stackObjectToCardStub(s));
    }
    return byId;
  }, [gameView?.stack]);

  const promptSourceDeckCard = useMemo(() => {
    if (!activePrompt?.sourceCardId) return undefined;
    const gc =
      visibleCardsById.get(activePrompt.sourceCardId) ??
      stackCardsBySourceId.get(activePrompt.sourceCardId);
    if (!gc) return undefined;
    return asDeckCard(gameDecks[gc.ownerId], gc);
  }, [activePrompt?.sourceCardId, visibleCardsById, stackCardsBySourceId, gameDecks]);

  const promptRevealedDeckCard = useMemo(() => {
    const rc = activePrompt?.revealedCard;
    if (!rc) return undefined;
    return asDeckCard(gameDecks[rc.ownerId], rc);
  }, [activePrompt?.revealedCard, gameDecks]);

  const handleLogCardHover = (
    cardId: string | null,
    e?: React.MouseEvent,
    options: {
      useAnchor?: boolean;
      placement?: "auto" | "top-center";
      anchorOverride?: DOMRect;
    } = {},
  ) => {
    if (draggingHandCard) {
      preview.dismiss();
      return;
    }
    if (!cardId) {
      preview.dismiss();
      return;
    }
    const card = visibleCardsById.get(cardId) ?? stackCardsBySourceId.get(cardId);
    if (!card) {
      preview.dismiss();
      return;
    }
    preview.handleMouseEnter(card, e, { ...options, useDelay: true });
  };

  const handleHoverCardGuarded = (
    card: GameCard | null,
    e?: React.MouseEvent,
    options: {
      useAnchor?: boolean;
      placement?: "auto" | "top-center";
      anchorOverride?: DOMRect;
    } = {},
  ) => {
    if (draggingHandCard) {
      preview.dismiss();
      return;
    }
    if (card === null) {
      // Use handleMouseLeave so the 250ms grace period allows the user
      // to move the mouse from the card to the preview popup.
      preview.handleMouseLeave();
    } else {
      preview.handleMouseEnter(card, e, { ...options, useDelay: true });
    }
  };

  // Suppress native browser tooltips inside the game view by stripping `title`
  // attributes as they appear. We move the value to `data-title` so it's still
  // accessible to custom tooltip components if needed, but the browser won't
  // show the default tooltip on hover.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const strip = (root: Element) => {
      for (const node of root.querySelectorAll("[title]")) {
        const val = node.getAttribute("title");
        if (val) {
          node.setAttribute("data-title", val);
          node.removeAttribute("title");
        }
      }
    };
    strip(el);
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "attributes" && m.attributeName === "title" && m.target instanceof Element) {
          const val = m.target.getAttribute("title");
          if (val) {
            m.target.setAttribute("data-title", val);
            m.target.removeAttribute("title");
          }
        }
        if (m.type === "childList") {
          for (const node of m.addedNodes) {
            if (node instanceof Element) strip(node);
          }
        }
      }
    });
    observer.observe(el, {
      attributes: true,
      attributeFilter: ["title"],
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (draggingHandCard) {
      preview.dismiss();
    }
  }, [draggingHandCard, preview]);

  // If the previewed card leaves all visible zones (e.g. removed from the game),
  // close the preview. We use visibleCardsById so that cards in graveyard, exile,
  // and command zones can still be previewed (e.g. in ZoneViewer modals).
  const hoverableCardIds = useMemo(() => {
    return new Set(visibleCardsById.keys());
  }, [visibleCardsById]);

  useEffect(() => {
    if (!preview.hoveredCard) return;
    if (
      !hoverableCardIds.has(preview.hoveredCard.id) &&
      !stackCardsBySourceId.has(preview.hoveredCard.id)
    ) {
      preview.dismiss();
    }
  }, [preview, hoverableCardIds, stackCardsBySourceId]);

  const cardNameById = useMemo(() => {
    const byId = new Map<string, string>();
    for (const c of visibleCardsById.values()) {
      byId.set(c.id, c.name);
    }
    for (const [sourceId, c] of stackCardsBySourceId.entries()) {
      if (!byId.has(sourceId)) byId.set(sourceId, c.name);
    }
    return byId;
  }, [visibleCardsById, stackCardsBySourceId]);

  const playerNameById = useMemo(
    () => new Map((gameView?.players ?? []).map((p) => [p.id, p.name] as const)),
    [gameView?.players],
  );

  // Live battlefield/zone GameCard for activated/triggered ability sources;
  // otherwise the stack-resident view synthesized in `stackCardsBySourceId`.
  // Every entry in `gameView.stack` has a corresponding entry in
  // `stackCardsBySourceId`, so this never returns undefined.
  const resolveStackCard = (stackItem: StackObject): GameCard =>
    visibleCardsById.get(stackItem.sourceId) ?? stackCardsBySourceId.get(stackItem.sourceId)!;

  // Card-flash animation reuses the live GameCard for the flashed source.
  // If the source is no longer in any visible zone or on the stack, skip the
  // flash rather than synthesize a stub.
  const activeFlashCard: GameCard | null = useMemo(() => {
    if (!activeFlash || activeFlash.kind !== "card") return null;
    return (
      visibleCardsById.get(activeFlash.cardId) ??
      stackCardsBySourceId.get(activeFlash.cardId) ??
      null
    );
  }, [activeFlash, visibleCardsById, stackCardsBySourceId]);

  // Auto-return to play menu when game is over.
  useEffect(() => {
    if (!gameView?.gameOver && activePrompt?.type !== PromptType.GameOver) return;
    const timer = setTimeout(() => endGame(), 3000);
    return () => clearTimeout(timer);
  }, [gameView?.gameOver, activePrompt?.type, endGame]);

  const navigate = useNavigate();
  useEffect(() => {
    if (!gameView?.gameOver) return;
    const pending = tryConsumeGauntletMatch();
    if (!pending) return;
    const humanWon = (gameView.winnerId ?? "").toLowerCase().includes("0");
    void useLimitedStore
      .getState()
      .recordGauntletOutcome(pending.gauntletId, humanWon, true, humanWon)
      .catch(() => {
        /* surfaced via lastError on the gauntlet view */
      })
      .finally(() => {
        navigate(`/gauntlet/${pending.gauntletId}`);
      });
  }, [gameView?.gameOver, gameView?.winnerId, navigate]);

  if (!isGameActive) return <Navigate to={exitTo ?? "/lobby"} replace />;

  // Loading. The prefetch gate keeps the loading screen up through the
  // initial critical-card prefetch even if the engine has already pushed a
  // gameView via the event listener — otherwise the UI would flip to the
  // board before its hand textures are decoded.
  if (!gameView || isPrefetchingCards) {
    return <GameLoadingScreen debugInfo={debugInfo} />;
  }
  if (!me) {
    return <GameLoadingScreen debugInfo={debugInfo || "Waiting for player state..."} />;
  }

  const battlefieldActivatableIds = new Set(
    promptType === PromptType.ChooseAction
      ? (activePrompt?.activatableAbilityIds ?? []).map((ability) => ability.cardId)
      : [],
  );
  // While picking an attack target, mark every legal defender card
  // (planeswalker / siege from the engine's `possibleDefenderIds`) as
  // choosable so battlefield clicks land on them — the engine doesn't
  // pre-mark them during attacker declaration.
  const markIfDefender = (c: GameCard): GameCard =>
    cardIsAttackTarget(c.id) ? { ...c, isChoosable: true } : c;
  const targetCardIdSet = new Set(
    promptType === PromptType.ChooseTargetCard || promptType === PromptType.ChooseTargetAny
      ? (activePrompt?.validCardIds ?? [])
      : [],
  );
  const markIfValidTarget = (c: GameCard): GameCard =>
    targetCardIdSet.has(c.id) ? { ...c, isChoosable: true } : c;
  // Pending attackers display as tapped so the user has an immediate
  // visual signal of "selected" without us drawing a misleading arrow
  // toward an arbitrary default opponent. Tap state flips for real on
  // the engine side once the attack commits.
  const pendingAttackerSet = new Set(pendingAttackers);
  const markIfPendingAttacker = (c: GameCard): GameCard =>
    pendingAttackerSet.has(c.id) ? { ...c, tapped: true } : c;
  const myPermanents = gameView.battlefield
    .filter((c) => c.controllerId === me.id)
    .map((c) => (battlefieldActivatableIds.has(c.id) ? { ...c, isChoosable: true } : c))
    .map(markIfDefender)
    .map(markIfValidTarget)
    .map(markIfPendingAttacker);
  if (debugCardEnabled) {
    myPermanents.push(buildDebugKeywordCard(me.id, debugCardName, debugBattlefieldKeywords));
  }
  const opponentPermanentsByPlayer = new Map(
    opponents.map((op) => [
      op.id,
      gameView.battlefield
        .filter((c) => c.controllerId === op.id)
        .map(markIfDefender)
        .map(markIfValidTarget),
    ]),
  );

  // Game over overlay
  if (gameView.gameOver || promptType === PromptType.GameOver) {
    return (
      <GameOverScreen
        winnerId={gameView.winnerId}
        concededPlayerIds={gameView.concededPlayerIds}
        me={me}
        opponents={opponents}
        turn={gameView.turn}
        onEndGame={endGame}
      />
    );
  }

  const turnFlashPlayerId = activeFlash?.kind === "turn" ? activeFlash.playerId : null;
  const effectivePriorityHighlightPlayerId = priorityHighlightPlayerId ?? gameView.priorityPlayerId;
  const shouldRenderStackFlashCard = activeFlash?.kind === "card";
  const shouldShowPreStackFlash = activeFlashCard?.types.includes("Land") ?? false;

  const targetingCursorActive =
    casting.showArrow && !casting.targetId && !intentPrefersArrow(casting.arrowIntent);

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col h-full min-h-0 overflow-hidden select-none"
      style={
        {
          "--flash-duration": `${flashDurationMs}ms`,
          "--playable-ring-color": withAlpha(themeColors.cardRing, 0.75),
          "--playable-glow-color": withAlpha(themeColors.cardRing, 0.3),
          "--playable-ring-color-strong": themeColors.cardRing,
          "--playable-glow-color-strong": withAlpha(themeColors.cardRing, 0.6),
          // Casting pulse: friendly-intent glow around the spell being cast.
          "--casting-ring-color": withAlpha(themeColors.arrow.friendlyTarget, 0.7),
          "--casting-ring-color-strong": themeColors.arrow.friendlyTarget,
          "--casting-glow-color": withAlpha(themeColors.arrow.friendlyTarget, 0.3),
          "--casting-glow-color-strong": withAlpha(themeColors.arrow.friendlyTarget, 0.6),
          // Rejection flash: hostile-intent glow used when a card is
          // dismissed from the mulligan / selection pool.
          "--rejecting-ring-color": withAlpha(themeColors.pointer.hostile, 0.9),
          "--rejecting-ring-color-strong": themeColors.pointer.hostile,
          "--rejecting-glow-color": withAlpha(themeColors.pointer.hostile, 0.5),
          "--rejecting-glow-color-strong": withAlpha(themeColors.pointer.hostile, 0.7),
        } as React.CSSProperties
      }
    >
      <FullscreenToggle />
      <PixiArrowsCanvas
        mainSceneRef={pixiSceneRef}
        opponentSceneRefs={opponentSceneRefsRef.current}
        arrowSpecs={arrowSpecs}
        pointerSpecs={pointerSpecs}
        castingArrow={
          casting.showArrow && casting.castingCardId && intentPrefersArrow(casting.arrowIntent)
            ? {
                castingCardId: casting.castingCardId,
                targetId: casting.targetId,
                hostile: casting.arrowHostile,
                intent: casting.arrowIntent,
              }
            : null
        }
      />
      <div className="flex min-h-0 flex-1 overflow-visible">
        <GameBoard
          pixiSceneRef={pixiSceneRef}
          pixiExternalBlockers={stackBlockerRect ? [stackBlockerRect] : []}
          getOpponentPixiSceneRef={getOpponentPixiSceneRef}
          handSelectionMode={mulliganPutBack.active}
          handSelectedIds={mulliganPutBack.selected}
          onHandCardToggle={mulliganPutBack.toggle}
          me={me}
          opponents={displayOpponents}
          myPermanents={myPermanents}
          opponentPermanentsByPlayer={opponentPermanentsByPlayer}
          myHand={gameView.myHand}
          graveyard={gameView.graveyard.map(markIfValidTarget)}
          exile={gameView.exile.map(markIfValidTarget)}
          myCommandZone={gameView.myCommandZone?.map(markIfValidTarget)}
          opponentZones={gameView.opponentZones}
          activePlayerId={gameView.activePlayerId}
          priorityPlayerId={effectivePriorityHighlightPlayerId}
          monarchId={gameView.monarchId ?? null}
          initiativeHolderId={gameView.initiativeHolderId ?? null}
          step={gameView.step}
          promptType={promptType}
          currentPrompt={activePrompt}
          pendingAttackers={pendingAttackers}
          pendingAttacker={pendingAttacker}
          selectedAttackDefenderId={attackDefenderId}
          blockAssignments={blockAssignments}
          playerIsTargetable={playerIsTargetable}
          turnFlashPlayerId={turnFlashPlayerId}
          zonePanelOrder={zonePanelOrder}
          placementGhost={placementGhost}
          isOverBattlefield={isOverBattlefield}
          battlefieldContainerRef={battlefieldContainerRef}
          draggingCardId={draggingHandCard?.id}
          castingCardId={casting.castingCardId}
          onHandCardDragStart={handleHandCardDragStart}
          onHandCardClick={handleHandCardAction}
          onHoverCard={handleHoverCardGuarded}
          onDismissHoverPreview={preview.dismiss}
          getHandActions={getHandActionOptions}
          onSelectHandAction={handlePreviewAction}
          onFlipCard={preview.flipCard}
          onBattlefieldClick={(card) => {
            if (manualApi) {
              void applyManualAction({
                type: "tapCard",
                cardId: card.id,
                tapped: !card.tapped,
              });
              return;
            }
            if (promptType === PromptType.ChooseAction && handleBattlefieldCardAction(card)) {
              return;
            }
            handleBattlefieldClick(card);
          }}
          onAttackerClick={handleAttackerClick}
          onTargetPlayer={handleTargetPlayer}
          onOpenZone={(title, cards, onClickCard) => {
            if (manualApi) {
              openManualZone(title, cards);
              return;
            }
            openZone(title, cards, onClickCard);
          }}
          onOpenZoneAndCast={(title, cards, onClickCard) =>
            openZoneAndCast(title, cards, (cardId) => {
              handleCastSpell(cardId);
              onClickCard(cardId);
            })
          }
          onReopenZoneTarget={reopenZoneTarget}
          onTargetFromZone={(cardId) => {
            closeZoneViewer();
            if (promptType === PromptType.ChooseTargetAny) {
              casting.wrappedTargetAny({ kind: "card", cardId });
            } else {
              casting.wrappedTargetCard(cardId);
            }
          }}
          onCastSpell={handleCastSpell}
          onTapLand={
            promptType === PromptType.ChooseAction ||
            promptType === PromptType.PayCombatCost ||
            promptType === PromptType.PayManaCost
              ? handleTapLand
              : undefined
          }
          onTapLands={
            promptType === PromptType.ChooseAction || promptType === PromptType.PayManaCost
              ? handleTapLands
              : undefined
          }
          onTapLandAbility={(cardId, abilityIndex, color) => tapLand(cardId, abilityIndex, color)}
          onUntapLand={
            promptType === PromptType.ChooseAction ||
            promptType === PromptType.PayCombatCost ||
            promptType === PromptType.PayManaCost
              ? handleUntapLand
              : undefined
          }
          onUntapLands={
            promptType === PromptType.ChooseAction || promptType === PromptType.PayManaCost
              ? handleUntapLands
              : undefined
          }
        />
      </div>

      {manualApi && <ManualTabletopControls gameView={gameView} api={manualApi} />}

      <RightActionPanel
        collapsed={isActionPanelCollapsed}
        onToggleCollapse={toggleActionPanel}
        gameLog={gameLog}
        onHoverLogCard={handleLogCardHover}
        resolveCardName={(cardId) => cardNameById.get(cardId) ?? cardId}
        resolvePlayerName={(playerId) => playerNameById.get(playerId) ?? playerId}
        snapshots={snapshots}
        canRestoreSnapshots={
          (!isMultiplayer || isHost) &&
          (promptType === PromptType.ChooseAction ||
            promptType === PromptType.ChooseAttackers ||
            promptType === PromptType.ChooseBlockers)
        }
        onRestoreSnapshot={restoreSnapshot}
      />

      {!manualApi && (
        <MainActionOverlay
          promptType={promptType}
          isWaitingForResponse={isWaitingForResponse}
          isAutoPassing={isAutoPassing}
          isPassingUntilEot={isPassingUntilEot}
          availableAttackerIds={activePrompt?.availableAttackerIds ?? []}
          pendingAttackers={pendingAttackers}
          onPassPriority={unifiedPass}
          onPassUntilEot={activatePassUntilEot}
          selectedAttackDefenderId={attackDefenderId}
          selectedAttackDefenderLabel={selectedAttackDefender?.label}
          multipleAttackDefenders={multipleAttackDefenders}
          onDeclareAttackers={declareAttackers}
          onBeginAttackTargetPick={selectAllAttackersForPick}
          pendingAttacker={pendingAttacker}
          attackerIds={activePrompt?.attackerIds ?? []}
          blockAssignments={blockAssignments}
          onDeclareBlockers={declareBlockers}
          onOpenStack={() => setSpellStackModalOpen(true)}
          onConcede={concede}
          resolveCardName={(cardId) => cardNameById.get(cardId) ?? cardId}
          resolveCard={(cardId) => visibleCardsById.get(cardId)}
          isMyPriority={gameView.priorityPlayerId === me.id}
          turn={gameView.turn}
          activePlayerName={
            gameView.players.find((p) => p.id === gameView.activePlayerId)?.name ?? "Unknown"
          }
          isMyTurn={gameView.activePlayerId === me.id}
          step={gameView.step}
          payManaCostInfo={
            promptType === PromptType.PayManaCost && activePrompt?.manaCost != null
              ? {
                  cardName: activePrompt.cardName ?? "Spell",
                  manaCost: activePrompt.manaCost,
                  manaPool: activePrompt.gameView?.players?.find((p) => p.isHuman)?.manaPool ?? {},
                  canConfirmFromPool: activePrompt.canConfirmFromPool ?? false,
                }
              : null
          }
          // Wrapped in an arrow so the MouseEvent the button forwards
          // doesn't clobber the `auto` default (truthy event ⇒ auto=true,
          // which would route to the wand path even when the player
          // meant to commit the already-tapped pool).
          onPayManaCost={() => payManaCost(false)}
          onAutoManaCost={autoManaCost}
          onCancelManaCost={cancelManaCost}
          mulliganCount={activePrompt?.mulliganCount ?? 0}
          onMulliganKeep={() => mulliganDecision(true)}
          onMulliganDraw={() => mulliganDecision(false)}
          mulliganPutBackCount={mulliganPutBack.count}
          mulliganSelectedCount={mulliganPutBack.selected.size}
          onMulliganPutBackConfirm={mulliganPutBack.confirm}
        />
      )}

      {awaitingAttackTarget && (
        <div className="pointer-events-none absolute top-4 left-1/2 z-50 -translate-x-1/2">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border/70 bg-background/90 px-4 py-2 shadow-lg backdrop-blur">
            <span className="text-sm font-semibold tracking-wide">
              Pick a target — click an opponent or planeswalker
            </span>
            <button
              className="text-xs font-medium uppercase text-muted-foreground hover:text-destructive"
              onClick={cancelAttackTargetPick}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {promptType === PromptType.ChooseTargetSpell && !spellStackModalOpen && (
        <div className="pointer-events-none absolute top-4 left-1/2 z-50 -translate-x-1/2">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border/70 bg-background/90 px-4 py-2 shadow-lg backdrop-blur">
            <span className="text-sm font-semibold tracking-wide">
              Click a glowing spell on the stack to counter it
            </span>
            <button
              className="text-xs font-medium uppercase text-muted-foreground hover:text-foreground"
              onClick={() => setSpellStackModalOpen(true)}
            >
              Expand
            </button>
          </div>
        </div>
      )}

      <StackDisplay
        stack={gameView.stack}
        resolveStackCard={resolveStackCard}
        onOpenStack={() => setSpellStackModalOpen(true)}
        flashCard={shouldRenderStackFlashCard ? activeFlashCard : null}
        flashToken={
          shouldRenderStackFlashCard
            ? `${activeFlash.cardId}:${activeFlash.cardName}:${activeFlash.setCode}`
            : null
        }
        showPreStackFlash={shouldShowPreStackFlash}
        rightPanelCollapsed={isActionPanelCollapsed}
        playerColorMap={playerColorMap}
        validSpellIds={
          promptType === PromptType.ChooseTargetSpell ? (activePrompt?.validSpellIds ?? []) : []
        }
        onTargetSpell={(spellId) => {
          targetSpell(spellId);
          setSpellStackModalOpen(false);
        }}
      />

      <GameModals
        promptType={promptType}
        currentPrompt={activePrompt}
        sourceDeckCard={promptSourceDeckCard}
        revealedDeckCard={promptRevealedDeckCard}
        viewingZone={viewingZone}
        onCloseZone={closeZone}
        zoneTargetSelector={zoneTargetSelector}
        onSelectZoneTarget={(cardId) => {
          casting.wrappedTargetCard(cardId);
          dismissZoneTarget();
        }}
        onCancelZoneTarget={dismissZoneTarget}
        libraryPeekModal={libraryPeekModal}
        onLibraryPeekConfirm={(selectedIds) => {
          if (libraryPeekModal!.mode === "scry") scryDecision(selectedIds);
          else if (libraryPeekModal!.mode === "surveil") surveilDecision(selectedIds);
          else if (libraryPeekModal!.mode === "discard") discardDecision(selectedIds);
          else digDecision(selectedIds);
          setLibraryPeekModal(null);
        }}
        spellStackModalOpen={spellStackModalOpen}
        stack={gameView.stack}
        validSpellIds={
          promptType === PromptType.ChooseTargetSpell ? (activePrompt?.validSpellIds ?? []) : []
        }
        onTargetSpell={(spellId) => {
          targetSpell(spellId);
          setSpellStackModalOpen(false);
        }}
        onCloseStack={() => setSpellStackModalOpen(false)}
        playerColorMap={playerColorMap}
        abilityPickerState={abilityPickerState}
        onSelectAbility={(ability) => {
          if (ability.kind === "cast") {
            castSpell(ability.cardId, ability.mode);
          } else if (ability.abilityIndex === -1) {
            tapLand(abilityPickerState!.cardId);
          } else if (ability.abilityIndex != null) {
            if (promptType === PromptType.PayManaCost && ability.isManaAbility) {
              tapLand(abilityPickerState!.cardId, ability.abilityIndex);
            } else {
              activateAbility(abilityPickerState!.cardId, ability.abilityIndex);
            }
          }
          closeAbilityPicker();
        }}
        onCancelAbilityPicker={closeAbilityPicker}
        onModeDecision={modeDecision}
        onRevealCardsAcknowledged={revealCardsAcknowledged}
        onPayCostToPreventEffectDecision={payCostToPreventEffectDecision}
        onOptionalTriggerDecision={optionalTriggerDecision}
        onPhyrexianDecision={(payLife) => respond({ type: "phyrexianDecision", payLife })}
        onKickerDecision={(kicked) => respond({ type: "kickerDecision", kicked })}
        onBuybackDecision={(paid) => respond({ type: "buybackDecision", buybackPaid: paid })}
        onMultikickerDecision={(kickCount) => respond({ type: "multikickerDecision", kickCount })}
        onReplicateDecision={(replicateCount) =>
          respond({ type: "replicateDecision", replicateCount })
        }
        onAlternativeCostDecision={(chosenIndex) =>
          respond({ type: "alternativeCostDecision", chosenIndex })
        }
        onColorDecision={colorDecision}
        onChooseCardsDecision={chooseCardsDecision}
        onTypeDecision={typeDecision}
        onNumberDecision={numberDecision}
        onCardNameDecision={cardNameDecision}
        onScryDecision={scryDecision}
        onSurveilDecision={surveilDecision}
        onDigDecision={digDecision}
        onDiscardDecision={discardDecision}
        onDamageOrderDecision={(orderedBlockerIds) =>
          respond({ type: "damageAssignmentOrderDecision", orderedBlockerIds })
        }
        onCombatDamageAssignmentDecision={(assignments) =>
          respond({ type: "combatDamageAssignmentDecision", assignments })
        }
        onPayCombatCost={payCombatCost}
        onDeclineCombatCost={declineCombatCost}
        onDelveDecision={delveDecision}
        onConvokeDecision={convokeDecision}
        onImproviseDecision={improviseDecision}
        onManaComboDecision={manaComboDecision}
        onExploreDecision={exploreDecision}
        onExertDecision={exertDecision}
        onEnlistDecision={enlistDecision}
        onReorderLibraryDecision={reorderLibraryDecision}
        onAssistDecision={assistDecision}
        onDiceRolledAcknowledged={diceRolledAcknowledged}
        onRollToIgnoreDecision={rollToIgnoreDecision}
        onRollToSwapDecision={rollToSwapDecision}
        onRollToModifyDecision={rollToModifyDecision}
        onDiceToRerollDecision={diceToRerollDecision}
        onRollSwapValueDecision={rollSwapValueDecision}
        onFirstPlayerRollAcknowledged={firstPlayerRollAcknowledged}
      />

      {playModePicker && (
        <PlayModePicker
          card={playModePicker.card}
          options={playModePicker.options}
          onSelect={(mode) => {
            castSpell(playModePicker.cardId, mode);
            closePlayModePicker();
          }}
          onCancel={closePlayModePicker}
        />
      )}

      {/* ── Targeting cursor (follows pointer, rides above modals) ─ */}
      <TargetingCursor
        active={targetingCursorActive}
        intent={casting.arrowIntent}
        hostile={casting.arrowHostile}
      />

      {/* ── Ghost card while dragging from hand ───────────── */}
      {draggingHandCard &&
        createPortal(
          <div
            className="fixed pointer-events-none z-[9999]"
            style={{ left: ghostPos.x - ghostCardW / 2, top: ghostPos.y - ghostCardH / 2 }}
          >
            <Card
              card={draggingHandCard}
              className={cn("shadow-2xl ring-2 ring-primary playable-card")}
              style={{ width: ghostCardW, height: ghostCardH }}
            />
          </div>,
          document.body,
        )}

      {/* ── Hover card preview ────────────────────────────── */}
      {/* Hide when any overlay modal is open or a modal-based prompt is active.
          Allow-list approach: only show the preview for prompt types that do NOT
          open a modal (battlefield interaction, targeting, inline panel prompts).
          Also hide for hand cards since the hand displays its own actions/preview. */}
      {preview.hoveredCard &&
        preview.hoveredCard.zoneId !== "hand" &&
        !draggingHandCard &&
        !viewingZone &&
        !zoneTargetSelector &&
        !libraryPeekModal &&
        !spellStackModalOpen &&
        !abilityPickerState &&
        (!promptType || HOVER_ALLOWED_PROMPTS.has(promptType)) && (
          <HoverCardPreview
            preview={preview}
            actions={hoveredCardActions}
            onSelectAction={handlePreviewAction}
          />
        )}
    </div>
  );
}
