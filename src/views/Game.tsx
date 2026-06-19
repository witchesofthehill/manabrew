import { useGameStore } from "@/stores/useGameStore";
import { asDeckCard } from "@/lib/decks";
import { partitionBoardTargets } from "@/lib/boardTargets";
import { useGameUIStore } from "@/stores/useGameUIStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useAutoResolvePrompt } from "@/components/prompts/internal/useAutoResolvePrompt";
import { useShallow } from "zustand/react/shallow";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActivatableAbilityInfo, GameCard, Player, StackObject } from "@/types/manabrew";
import { GameModals } from "@/components/game/GameModals";
import { GameOverScreen } from "@/components/game/GameOverScreen";
import { GameLoadingScreen } from "@/components/game/GameLoadingScreen";
import { WaitingForPlayerScreen } from "@/components/game/WaitingForPlayerScreen";
import { FullscreenToggle } from "@/components/game/FullscreenToggle";
import { ManualTabletopControls } from "@/components/game/ManualTabletopControls";
import { MainActionOverlay, RightActionPanel } from "@/components/game/panels";
import { StackDisplay } from "@/components/game/panels/StackDisplay";
import { useCastingState } from "@/hooks/useCastingState";
import type { BoardScene } from "@/pixi/board/BoardScene";
import { PERIMETER_SIDE_FRACTION } from "@/pixi/board/boardLayout";
import { isFeatureEnabled } from "@/featureFlags";
import { buildArrowSpecs } from "@/components/game/arrowSpecs";
import { getDisplayedManaAbilities } from "@/components/game/manaUtils";
import { PlayModePicker } from "@/components/game/PlayModePicker";
import { HAND_CARD_BASE } from "@/components/game/game.styles";
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
import { useMultiplayerInterruption } from "@/hooks/useMultiplayerInterruption";
import { GameBoard } from "@/components/game/GameBoard";
import { withAlpha } from "@/themes/gameTheme";
import { useTheme } from "@/hooks/useTheme";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { useLimitedStore } from "@/stores/useLimitedStore";
import { tryConsumeGauntletMatch } from "@/lib/gauntletReturn";
import { intentPrefersArrow } from "@/types/promptType";
import type { PromptType } from "@/protocol";
import { declareAttackersOutput } from "@/components/prompts/internal/playerActions";
import { TargetingCursor } from "@/components/game/TargetingCursor";
import { OPPONENT_SEATS } from "@/components/game/game.types";
import { useStackUIStore } from "@/stores/useStackUIStore";
import { useGameDevStore, DEBUG_KEYWORD_CARD_ID } from "@/stores/useGameDevStore";
import { stackObjectToCardStub, isPermanentSpellCard } from "@/components/game/game.utils";
import { createPortal } from "react-dom";
import { Card } from "@/components/game/Card";
import { cn } from "@/lib/utils";
import { applyManualTabletopAction, getSelectedGameRuntime } from "@/game";
import type { HandActionOption } from "@/stores/useGameUIStore";
import type { GameRuntime, ManualTabletopApi } from "@/game";

const HOVER_ALLOWED_PROMPTS = new Set<PromptType>([
  "chooseAction",
  "chooseAttackers",
  "chooseBlockers",
  "chooseBoardTargets",
  "payManaCost",
  "gameOver",
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
    controllerId,
    ownerId: controllerId,
    zoneId: "dev-zone",
    keywords,
  };
}

interface GameProps {
  exitTo?: string;
}

export default function Game({ exitTo }: GameProps = {}) {
  const interruption = useMultiplayerInterruption();
  useAutoResolvePrompt(interruption.waiting);
  const gameView = useGameStore((s) => s.gameView);
  const myPlayerSlot = useGameStore((s) => s.myPlayerSlot);
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
  const { respond, concede, endGame, restoreSnapshot, gameDecks } = useGameStore(
    useShallow((s) => ({
      respond: s.respond,
      concede: s.concede,
      endGame: s.endGame,
      restoreSnapshot: s.restoreSnapshot,
      gameDecks: s.gameDecks,
    })),
  );
  const flashDurationMs = usePreferencesStore((s) => s.flashDurationMs);
  const boardArrangementPref = usePreferencesStore((s) => s.boardArrangement);
  const boardArrangement = isFeatureEnabled("wraparoundBoardLayout") ? boardArrangementPref : "row";
  const zonePanelOrder = usePreferencesStore((s) => s.zonePanelOrder);
  const vScale = useHandScale();
  const themeColors = useTheme().gameTheme;
  const location = useLocation();
  const devExtraOpponents =
    (location.state as { devExtraOpponents?: number } | null)?.devExtraOpponents ?? 0;
  const containerRef = useRef<HTMLDivElement>(null);
  const boardSceneRef = useRef<BoardScene | null>(null);

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
      const scene = boardSceneRef.current;
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
  const promptType = activePrompt?.input.type;
  const chooseActionInput = activePrompt?.input.type === "chooseAction" ? activePrompt.input : null;
  const chooseAttackersInput =
    activePrompt?.input.type === "chooseAttackers" ? activePrompt.input : null;
  const chooseBlockersInput =
    activePrompt?.input.type === "chooseBlockers" ? activePrompt.input : null;
  const damageOrderInput =
    activePrompt?.input.type === "chooseDamageAssignmentOrder" ? activePrompt.input : null;
  const payCombatCostInput =
    activePrompt?.input.type === "payCombatCost" ? activePrompt.input : null;
  const payManaCostInput = activePrompt?.input.type === "payManaCost" ? activePrompt.input : null;
  const mulliganInput = activePrompt?.input.type === "mulligan" ? activePrompt.input : null;
  const tappableLandIds = useMemo<string[]>(
    () =>
      chooseActionInput
        ? chooseActionInput.actions.flatMap((a) =>
            a.type === "activateAbility" && a.isManaAbility ? [a.cardId] : [],
          )
        : (payCombatCostInput?.tappableSourceIds ?? payManaCostInput?.tappableSourceIds ?? []),
    [chooseActionInput, payCombatCostInput, payManaCostInput],
  );
  const untappableLandIds = useMemo<string[]>(
    () =>
      chooseActionInput
        ? chooseActionInput.actions.flatMap((a) => (a.type === "undoMana" ? [a.cardId] : []))
        : (payCombatCostInput?.untappableSourceIds ?? payManaCostInput?.untappableSourceIds ?? []),
    [chooseActionInput, payCombatCostInput, payManaCostInput],
  );

  const mulliganPutBack = useMulliganSelection(activePrompt, (cardIds) =>
    respond({ type: "mulliganPutBackDecision", cardIds }),
  );

  const casting = useCastingState({
    currentPrompt: activePrompt,
    respond,
  });

  const boardTargets = useMemo(
    () =>
      activePrompt?.input.type === "chooseBoardTargets"
        ? partitionBoardTargets(activePrompt.input, gameView)
        : null,
    [activePrompt, gameView],
  );

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

  const toAbilityOption = (
    a: {
      cardId: string;
      abilityIndex: number;
      description: string;
      isManaAbility: boolean;
      cost?: string;
      displayManaLetters?: string[];
      colorChoice?: string;
    },
    actionId?: string,
  ): HandActionOption => ({
    kind: "ability" as const,
    cardId: a.cardId,
    abilityIndex: a.abilityIndex,
    label: a.description,
    isManaAbility: a.isManaAbility,
    cost: a.cost,
    displayManaLetters: a.displayManaLetters,
    colorChoice: a.colorChoice,
    actionId,
  });

  const castOptionsByCardId = useMemo(() => {
    const map = new Map<string, HandActionOption[]>();
    for (const a of chooseActionInput?.actions ?? []) {
      if (a.type !== "cast") continue;
      const arr = map.get(a.cardId) ?? [];
      arr.push({
        kind: "cast" as const,
        cardId: a.cardId,
        mode: a.mode,
        label: a.modeLabel,
        actionId: a.id,
      });
      map.set(a.cardId, arr);
    }
    return map;
  }, [chooseActionInput?.actions]);

  const abilitiesByCardId = useMemo(() => {
    const map = new Map<string, HandActionOption[]>();
    for (const a of chooseActionInput?.actions ?? []) {
      if (a.type !== "activateAbility" || a.isManaAbility) continue;
      const arr = map.get(a.cardId) ?? [];
      arr.push(toAbilityOption(a, a.id));
      map.set(a.cardId, arr);
    }
    return map;
  }, [chooseActionInput?.actions]);

  const manaAbilitiesByCardId = useMemo(() => {
    const map = new Map<string, HandActionOption[]>();
    if (chooseActionInput) {
      for (const a of chooseActionInput.actions) {
        if (a.type !== "activateAbility" || !a.isManaAbility) continue;
        const arr = map.get(a.cardId) ?? [];
        const displayed = getDisplayedManaAbilities(a.cardId, [
          {
            cardId: a.cardId,
            abilityIndex: a.abilityIndex,
            description: a.description,
            isManaAbility: true,
            cost: a.cost,
            producedMana: a.producedMana,
            actionId: a.id,
          },
        ]);
        arr.push(...displayed.map((ab) => toAbilityOption(ab, ab.actionId)));
        map.set(a.cardId, arr);
      }
      return map;
    }
    const rawOptions =
      payCombatCostInput?.manaAbilityOptions ?? payManaCostInput?.manaAbilityOptions ?? [];
    if (rawOptions.length === 0) return map;
    const byCard = new Map<string, ActivatableAbilityInfo[]>();
    for (const ab of rawOptions) {
      const arr = byCard.get(ab.cardId) ?? [];
      arr.push(ab);
      byCard.set(ab.cardId, arr);
    }
    for (const [cardId, abilities] of byCard) {
      map.set(
        cardId,
        getDisplayedManaAbilities(cardId, abilities).map((ab) => toAbilityOption(ab)),
      );
    }
    return map;
  }, [
    chooseActionInput,
    payCombatCostInput?.manaAbilityOptions,
    payManaCostInput?.manaAbilityOptions,
  ]);

  const tappableLandIdSet = useMemo(() => new Set(tappableLandIds), [tappableLandIds]);

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

  const castOptions = useCallback(
    (card: GameCard): HandActionOption[] => castOptionsByCardId.get(card.id) ?? [],
    [castOptionsByCardId],
  );

  const getHandActionOptions = useCallback(
    (card: GameCard): HandActionOption[] =>
      manualApi
        ? getManualCardActions(card)
        : [...castOptions(card), ...(abilitiesByCardId.get(card.id) ?? [])],
    [manualApi, getManualCardActions, castOptions, abilitiesByCardId],
  );

  const getBattlefieldAbilityOptions = useCallback(
    (card: GameCard): HandActionOption[] => abilitiesByCardId.get(card.id) ?? [],
    [abilitiesByCardId],
  );

  const getCardActions = useCallback(
    (card: GameCard): HandActionOption[] => {
      if (manualApi) return getManualCardActions(card);
      if (promptType === "payManaCost") {
        return manaAbilitiesByCardId.get(card.id) ?? [];
      }
      if (promptType !== "chooseAction") return [];

      const abilities = [...(abilitiesByCardId.get(card.id) ?? [])];
      const manaAbilities = manaAbilitiesByCardId.get(card.id) ?? [];
      const isManaSource = tappableLandIdSet.has(card.id);

      if (isManaSource && manaAbilities.length > 0) {
        abilities.unshift(...manaAbilities);
      }
      return [...castOptions(card), ...abilities];
    },
    [
      manualApi,
      getManualCardActions,
      promptType,
      castOptions,
      abilitiesByCardId,
      manaAbilitiesByCardId,
      tappableLandIdSet,
    ],
  );

  const respondHandAction = (option: HandActionOption): boolean => {
    if (option.actionId != null) {
      respond({ type: "act", actionId: option.actionId });
      return true;
    }
    if (option.kind === "ability" && option.isManaAbility) {
      respond({
        type: "tapForMana",
        cardId: option.cardId,
        abilityIndex: option.abilityIndex,
        color: option.colorChoice,
      });
      return true;
    }
    if (option.kind === "ability" && option.abilityIndex != null) {
      respond({
        type: "tapForMana",
        cardId: option.cardId,
        abilityIndex: option.abilityIndex >= 0 ? option.abilityIndex : undefined,
      });
      return true;
    }
    return false;
  };

  const handleCastSpell = (cardId: string) => {
    const acts = chooseActionInput?.actions ?? [];
    const castActions = acts.flatMap((a) => (a.type === "cast" && a.cardId === cardId ? [a] : []));
    if (castActions.length > 1) {
      const myPlayer = gameView?.players.find((p) => p.id === myPlayerSlot);
      const gc =
        myPlayer?.hand.find((c) => c.id === cardId) ??
        myPlayer?.graveyard.find((c) => c.id === cardId) ??
        myPlayer?.exile.find((c) => c.id === cardId) ??
        myPlayer?.commandZone.find((c) => c.id === cardId);
      if (!gc) throw new Error(`No game card to cast: ${cardId}`);
      const card = asDeckCard(gameDecks[gc.ownerId], gc);
      openPlayModePicker({
        cardId,
        card,
        options: castActions.map((a) => ({
          actionId: a.id,
          cardId: a.cardId,
          mode: a.mode,
          modeLabel: a.modeLabel,
        })),
      });
      return;
    }
    const single = castActions[0];
    if (single) respond({ type: "act", actionId: single.id });
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
      respondHandAction(actions[0]);
      return;
    }

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
      return respondHandAction(abilities[0]);
    }

    preview.showSticky(card, e?.clientX, e?.clientY);
    return true;
  };

  const {
    pendingAttackers,
    pendingAttacker,
    pendingBlocker,
    attackDefenderId,
    blockAssignments,
    blockError,
    blockRequirement,
    assignBlockPair,
    unassignBlock,
    damageOrder,
    undoDamageOrder,
    multipleAttackDefenders,
    awaitingAttackTarget,
    playerIsTargetable,
    handleTargetPlayer,
    handleBattlefieldClick,
    handleAttackerClick,
    selectAllAttackersForPick,
    cancelAttackTargetPick,
  } = useCombatState({
    promptType,
    targetCard: casting.wrappedTargetCard,
    targetPlayer: casting.wrappedTargetPlayer,
    respond,
    currentPrompt: activePrompt,
    targetableCardIds: boardTargets?.battlefieldCardIds ?? [],
    targetablePlayerIds: boardTargets?.playerIds ?? [],
    engineHasBlocks: (gameView?.combatAssignments?.length ?? 0) > 0,
  });
  const selectedAttackDefender = chooseAttackersInput?.attackTargets.find(
    (target) => target.id === attackDefenderId,
  );
  const blockRequirementError = useMemo<string | null>(() => {
    if (!blockRequirement) return null;
    const name =
      gameView?.battlefield.find((c) => c.id === blockRequirement.attackerId)?.name ??
      "This attacker";
    const creatures = (n: number) => `${n} ${n === 1 ? "creature" : "creatures"}`;
    return blockRequirement.kind === "min"
      ? `${name} must be blocked by ${creatures(blockRequirement.count)} (${blockRequirement.assigned} assigned).`
      : `${name} can be blocked by at most ${creatures(blockRequirement.count)} (${blockRequirement.assigned} assigned).`;
  }, [blockRequirement, gameView?.battlefield]);
  const { declineTargets } = casting;
  const targetCompletion = useMemo(() => {
    if (activePrompt?.input.type !== "chooseBoardTargets") return null;
    const input = activePrompt.input;
    if (input.maxTargets <= input.minTargets || input.chosenTargets < input.minTargets) {
      return null;
    }
    return {
      label: input.chosenTargets === 0 ? "Skip" : "Done",
      onComplete: declineTargets,
    };
  }, [activePrompt, declineTargets]);

  function openZone(
    title: string,
    cards: GameCard[],
    onClickCard?: (cardId: string) => void,
    clickableCardIds?: string[],
    targetHostile?: boolean,
  ) {
    openZoneViewer({ title, cards, onClickCard, clickableCardIds, targetHostile });
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
    clickableCardIds?: string[],
  ) {
    openZoneViewer({
      title,
      cards,
      clickableCardIds,
      onClickCard: (cardId) => {
        closeZoneViewer();
        onClickCard(cardId);
      },
    });
  }

  const handleTapLand = (card: GameCard) => {
    const paymentManaOptions =
      payCombatCostInput?.manaAbilityOptions ?? payManaCostInput?.manaAbilityOptions;
    if (paymentManaOptions) {
      const manaAbilities = getDisplayedManaAbilities(card.id, paymentManaOptions).map((ab) =>
        toAbilityOption(ab),
      );

      if (manaAbilities.length > 1) {
        preview.showSticky(card);
        return;
      }
      if (manaAbilities.length === 1) {
        respond({
          type: "tapForMana",
          cardId: card.id,
          abilityIndex: manaAbilities[0].abilityIndex,
          color: manaAbilities[0].colorChoice,
        });
        return;
      }
      respond({ type: "tapForMana", cardId: card.id });
      return;
    }

    if (promptType !== "chooseAction") {
      respond({ type: "tapForMana", cardId: card.id });
      return;
    }

    const manaAbilities = manaAbilitiesByCardId.get(card.id) ?? [];
    if (manaAbilities.length > 1) {
      preview.showSticky(card);
      return;
    }
    if (manaAbilities.length === 1) {
      const actionId =
        manaAbilities[0].actionId ??
        chooseActionInput?.actions.find(
          (a) =>
            a.type === "activateAbility" &&
            a.isManaAbility &&
            a.cardId === card.id &&
            a.abilityIndex === manaAbilities[0].abilityIndex,
        )?.id;
      if (actionId) respond({ type: "act", actionId });
      return;
    }

    const cardActions = (chooseActionInput?.actions ?? []).filter(
      (a) => a.type === "activateAbility" && a.cardId === card.id,
    );
    if (cardActions.length > 1) {
      preview.showSticky(card);
    } else if (cardActions.length === 1) {
      respond({ type: "act", actionId: cardActions[0].id });
    }
  };

  const handleUntapLand = (card: GameCard) => {
    const undo = chooseActionInput?.actions.find(
      (a) => a.type === "undoMana" && a.cardId === card.id,
    );
    if (undo) {
      respond({ type: "act", actionId: undo.id });
      return;
    }
    respond({ type: "untap", cardId: card.id });
  };

  const pendingTapQueueRef = useRef<string[]>([]);
  const pendingUntapQueueRef = useRef<string[]>([]);

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

  const tapResponse = (id: string) => {
    const option = manaAbilitiesByCardId.get(id)?.[0];
    if (option?.actionId) {
      respond({ type: "act", actionId: option.actionId });
    } else if (option) {
      respond({
        type: "tapForMana",
        cardId: id,
        abilityIndex: option.abilityIndex,
        color: option.colorChoice,
      });
    } else if (promptType === "chooseAction") {
      const action = chooseActionInput?.actions.find(
        (a) => a.type === "activateAbility" && a.isManaAbility && a.cardId === id,
      );
      if (action) respond({ type: "act", actionId: action.id });
    } else {
      respond({ type: "tapForMana", cardId: id });
    }
  };
  const untapResponse = (id: string) => {
    const a = chooseActionInput?.actions.find((x) => x.type === "undoMana" && x.cardId === id);
    if (a) respond({ type: "act", actionId: a.id });
    else respond({ type: "untap", cardId: id });
  };

  const handleTapLands = (cardIds: string[]) =>
    startBatchLandAction(cardIds, pendingTapQueueRef, tapResponse);

  const handleUntapLands = (cardIds: string[]) =>
    startBatchLandAction(cardIds, pendingUntapQueueRef, untapResponse);

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

  useEffect(() => {
    if (isWaitingForResponse) return;
    if (!promptType) return;
    if (promptType !== "chooseAction" && promptType !== "payManaCost") {
      pendingTapQueueRef.current = [];
      pendingUntapQueueRef.current = [];
      return;
    }
    if (drainQueue(pendingTapQueueRef, tappableLandIds, tapResponse)) return;
    drainQueue(pendingUntapQueueRef, untappableLandIds, untapResponse);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePrompt, isWaitingForResponse, promptType, tappableLandIds, untappableLandIds]);

  const _earlyMyPlayerId =
    gameView?.players?.find((p) => p.isHuman)?.id ?? gameView?.players?.[0]?.id ?? "";
  const {
    isAutoPassing,
    isPassingUntilEot,
    unifiedPass,
    activatePassUntilEot,
    libraryPeekModal,
    setLibraryPeekModal,
    spellStackModalOpen,
    setSpellStackModalOpen,
  } = usePromptEffects({
    currentPrompt: activePrompt,
    gameView,
    isWaitingForResponse,
    respond,
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
    if (promptType !== "payManaCost") return;
    if (activePrompt?.input.canConfirmFromPool) {
      respond({ type: "payManaCost", auto: false });
    } else {
      respond({ type: "payManaCost", auto: true });
    }
  };
  const confirmPromptRef = useRef<() => boolean>(() => false);
  confirmPromptRef.current = () => {
    if (promptType === "payManaCost") {
      payManaPrimaryRef.current();
      return true;
    }
    if (promptType === "mulligan") {
      respond({ type: "mulliganDecision", keep: true });
      return true;
    }
    if (promptType === "mulliganPutBack") {
      if (!mulliganPutBack.active || mulliganPutBack.selected.size !== mulliganPutBack.count) {
        return false;
      }
      mulliganPutBack.confirm();
      return true;
    }
    if (promptType === "chooseAttackers") {
      if (pendingAttackers.length === 0) return false;
      respond(
        declareAttackersOutput(activePrompt, pendingAttackers, attackDefenderId ?? undefined),
      );
      return true;
    }
    if (promptType === "chooseBlockers") {
      if (blockAssignments.length === 0 || blockRequirement) return false;
      respond({ type: "declareBlockers", assignments: blockAssignments });
      return true;
    }
    return false;
  };

  const preview = useCardPreview([
    viewingZone,
    libraryPeekModal,
    spellStackModalOpen,
    abilityPickerState,
  ]);

  const battlefieldContainerRef = useRef<HTMLDivElement>(null);
  const { draggingHandCard, ghostPos, isOverBattlefield, startHandCardDrag } = useHandDrag({
    battlefieldContainerRef,
    handDropExclusionPx: Math.round(HAND_CARD_BASE.containerH * vScale * 0.35),
    onCastSpell: handleCastSpell,
    dismissHover: preview.dismiss,
  });

  const draggingIsPermanent = draggingHandCard ? isPermanentSpellCard(draggingHandCard) : false;
  const ghostCardW = Math.round(HAND_CARD_BASE.cardW * vScale);
  const ghostCardH = Math.round(HAND_CARD_BASE.cardH * vScale);

  const hoveredCardActions = preview.hoveredCard ? getCardActions(preview.hoveredCard) : [];

  const handlePreviewAction = (action: HandActionOption) => {
    preview.dismiss();
    if (action.kind === "manual-move" && action.toZoneId) {
      const myPlayer = gameView?.players.find((p) => p.id === myPlayerSlot);
      const sourceCard = [
        ...(myPlayer?.hand ?? []),
        ...(gameView?.battlefield ?? []),
        ...(myPlayer?.graveyard ?? []),
        ...(myPlayer?.exile ?? []),
        ...(myPlayer?.commandZone ?? []),
      ].find((card) => card.id === action.cardId);
      void applyManualAction({
        type: "moveCard",
        cardId: action.cardId,
        fromZoneId: sourceCard?.zoneId ?? "",
        toZoneId: action.toZoneId,
      });
      return;
    }
    if (action.kind === "manual-tap") {
      void applyManualAction({
        type: "tapCard",
        cardId: action.cardId,
        tapped: action.tapped ?? true,
      });
      return;
    }
    respondHandAction(action);
  };

  const activeFlash = useFlashQueue(flashDurationMs);

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

  useGameEventListeners();
  useGamePrefetch();

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.repeat) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (manualApi) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (document.querySelector('[role="dialog"]')) return;
        if (confirmPromptRef.current()) return;
        if (promptType === "chooseAction") {
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

  const me =
    gameView?.players?.find((p) => p.id === myPlayerSlot) ??
    gameView?.players?.find((p) => p.isHuman) ??
    gameView?.players?.[0];
  const opponents = useMemo(
    () => gameView?.players?.filter((p) => p.id !== me?.id) ?? [],
    [gameView?.players, me?.id],
  );
  const opponent = opponents[0];

  const playerColorMap = useMemo(() => {
    const map = new Map<string, string>();
    if (me) map.set(me.id, themeColors.playerColors.self);
    opponents.forEach((opp, i) => {
      const seat = OPPONENT_SEATS[i] ?? "opponent1";
      map.set(opp.id, themeColors.playerColors[seat]);
    });
    return map;
  }, [me, opponents, themeColors.playerColors]);
  const displayOpponents = useMemo(
    () => [
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
            hand: [],
            graveyard: [],
            exile: [],
            commandZone: [],
            libraryCount: 40,
            manaPool: {} as Record<string, number>,
          }) as Player,
      ),
    ],
    [opponents, devExtraOpponents],
  );
  const attackerIds = useMemo(
    () => chooseBlockersInput?.attackers.map((a) => a.attackerId) ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chooseBlockersInput?.attackers.map((a) => a.attackerId).join(",")],
  );
  const combatAssignments = useMemo(
    () => gameView?.combatAssignments ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gameView?.combatAssignments?.map((a) => `${a.blockerId}:${a.attackerId}`).join(",")],
  );

  const hoveredStackObjectIdForSpecs = useStackUIStore((s) => s.hoveredStackObjectId);
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
        stageBlockers: true,
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

  const debugBattlefieldKeywords = useGameDevStore((s) => s.debugBattlefieldKeywords);
  const debugCardEnabled = useGameDevStore((s) => s.debugCardEnabled);
  const debugCardName = useGameDevStore((s) => s.debugCardName);

  const visibleCardsById = useMemo(() => {
    if (!gameView) return new Map<string, GameCard>();
    const cards: GameCard[] = [
      ...gameView.battlefield,
      ...gameView.players.flatMap((p) => [...p.hand, ...p.graveyard, ...p.exile, ...p.commandZone]),
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

  const myPermanents = useMemo<GameCard[]>(() => {
    if (!gameView || !me) return [];
    const pendingSet = new Set(pendingAttackers);
    const list = gameView.battlefield
      .filter((c) => c.controllerId === me.id)
      .map((c) => (pendingSet.has(c.id) ? { ...c, tapped: true } : c));
    if (debugCardEnabled) {
      list.push(buildDebugKeywordCard(me.id, debugCardName, debugBattlefieldKeywords));
    }
    return list;
  }, [gameView, me, pendingAttackers, debugCardEnabled, debugCardName, debugBattlefieldKeywords]);

  const opponentPermanentsByPlayer = useMemo(() => {
    const map = new Map<string, GameCard[]>();
    if (!gameView) return map;
    for (const op of opponents) {
      map.set(
        op.id,
        gameView.battlefield.filter((c) => c.controllerId === op.id),
      );
    }
    return map;
  }, [gameView, opponents]);

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
      preview.handleMouseLeave();
    } else {
      preview.handleMouseEnter(card, e, { ...options, useDelay: true });
    }
  };

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

  const resolveStackCard = (stackItem: StackObject): GameCard =>
    visibleCardsById.get(stackItem.sourceId) ?? stackCardsBySourceId.get(stackItem.sourceId)!;

  const activeFlashCard: GameCard | null = useMemo(() => {
    if (!activeFlash || activeFlash.kind !== "card") return null;
    return (
      visibleCardsById.get(activeFlash.cardId) ??
      stackCardsBySourceId.get(activeFlash.cardId) ??
      null
    );
  }, [activeFlash, visibleCardsById, stackCardsBySourceId]);

  useEffect(() => {
    if (!gameView?.gameOver && activePrompt?.input.type !== "gameOver") return;
    const timer = setTimeout(() => endGame(), 3000);
    return () => clearTimeout(timer);
  }, [gameView?.gameOver, activePrompt?.input.type, endGame]);

  const navigate = useNavigate();
  useEffect(() => {
    if (!gameView?.gameOver) return;
    const pending = tryConsumeGauntletMatch();
    if (!pending) return;
    const humanWon = gameView.winnerId != null && gameView.winnerId === myPlayerSlot;
    void useLimitedStore
      .getState()
      .recordGauntletOutcome(pending.gauntletId, humanWon, true, humanWon)
      .catch(() => {})
      .finally(() => {
        navigate(`/gauntlet/${pending.gauntletId}`);
      });
  }, [gameView?.gameOver, gameView?.winnerId, myPlayerSlot, navigate]);

  if (!isGameActive) return <Navigate to={exitTo ?? "/lobby"} replace />;

  if (!gameView || isPrefetchingCards) {
    return <GameLoadingScreen debugInfo={debugInfo} />;
  }
  if (!me) {
    return <GameLoadingScreen debugInfo={debugInfo || "Waiting for player state..."} />;
  }

  const promptPlayableIds = new Set(
    promptType === "chooseAction"
      ? (chooseActionInput?.actions ?? []).flatMap((a) =>
          a.type === "cast" || a.type === "activateAbility" ? [a.cardId] : [],
        )
      : [],
  );
  const markIfPlayable = (c: GameCard): GameCard =>
    promptPlayableIds.has(c.id) ? { ...c, isPlayable: true } : c;

  if (gameView.gameOver || promptType === "gameOver") {
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

  const castingArrow =
    casting.showArrow &&
    casting.castingCardId &&
    !casting.targetId &&
    intentPrefersArrow(casting.arrowIntent)
      ? { sourceCardId: casting.castingCardId, hostile: casting.arrowHostile }
      : null;

  return (
    <div
      ref={containerRef}
      className="font-game relative flex flex-col h-full min-h-0 overflow-hidden select-none"
      style={
        {
          "--flash-duration": `${flashDurationMs}ms`,
          "--playable-ring-color": withAlpha(themeColors.cardRing, 0.75),
          "--playable-glow-color": withAlpha(themeColors.cardRing, 0.3),
          "--playable-ring-color-strong": themeColors.cardRing,
          "--playable-glow-color-strong": withAlpha(themeColors.cardRing, 0.6),
          "--casting-ring-color": withAlpha(themeColors.arrow.friendlyTarget, 0.7),
          "--casting-ring-color-strong": themeColors.arrow.friendlyTarget,
          "--casting-glow-color": withAlpha(themeColors.arrow.friendlyTarget, 0.3),
          "--casting-glow-color-strong": withAlpha(themeColors.arrow.friendlyTarget, 0.6),
          "--rejecting-ring-color": withAlpha(themeColors.pointer.hostile, 0.9),
          "--rejecting-ring-color-strong": themeColors.pointer.hostile,
          "--rejecting-glow-color": withAlpha(themeColors.pointer.hostile, 0.5),
          "--rejecting-glow-color-strong": withAlpha(themeColors.pointer.hostile, 0.7),
        } as React.CSSProperties
      }
    >
      <FullscreenToggle />
      <div className="flex min-h-0 flex-1 overflow-visible">
        <GameBoard
          boardSceneRef={boardSceneRef}
          pixiExternalBlockers={stackBlockerRect ? [stackBlockerRect] : []}
          handSelectionMode={mulliganPutBack.active}
          handSelectedIds={mulliganPutBack.selected}
          onHandCardToggle={mulliganPutBack.toggle}
          me={me}
          opponents={displayOpponents}
          myPermanents={myPermanents}
          opponentPermanentsByPlayer={opponentPermanentsByPlayer}
          myHand={(me?.hand ?? []).map(markIfPlayable)}
          graveyard={(me?.graveyard ?? []).map(markIfPlayable)}
          exile={(me?.exile ?? []).map(markIfPlayable)}
          myCommandZone={(me?.commandZone ?? []).map(markIfPlayable)}
          activePlayerId={gameView.activePlayerId}
          priorityPlayerId={effectivePriorityHighlightPlayerId}
          monarchId={gameView.monarchId ?? null}
          initiativeHolderId={gameView.initiativeHolderId ?? null}
          step={gameView.step}
          promptType={promptType}
          currentPrompt={activePrompt}
          boardTargets={boardTargets}
          pendingAttackers={pendingAttackers}
          pendingAttacker={pendingAttacker}
          pendingBlocker={pendingBlocker}
          damageOrder={damageOrder}
          damageOrderBlockerIds={damageOrderInput?.blockerIds ?? []}
          selectedAttackDefenderId={attackDefenderId}
          blockAssignments={blockAssignments}
          combatAssignments={combatAssignments}
          arrowSpecs={arrowSpecs}
          castingArrow={castingArrow}
          playerIsTargetable={playerIsTargetable}
          turnFlashPlayerId={turnFlashPlayerId}
          zonePanelOrder={zonePanelOrder}
          isOverBattlefield={isOverBattlefield}
          battlefieldContainerRef={battlefieldContainerRef}
          draggingCardId={draggingHandCard?.id}
          draggingIsPermanent={draggingIsPermanent}
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
            if (promptType === "chooseAction" && handleBattlefieldCardAction(card)) {
              return;
            }
            handleBattlefieldClick(card);
          }}
          onAttackerClick={handleAttackerClick}
          onAssignBlock={assignBlockPair}
          onUnassignBlock={unassignBlock}
          onTargetPlayer={handleTargetPlayer}
          onOpenZone={(title, cards, onClickCard, clickableCardIds, targetHostile) => {
            if (manualApi) {
              openManualZone(title, cards);
              return;
            }
            openZone(title, cards, onClickCard, clickableCardIds, targetHostile);
          }}
          onOpenZoneAndCast={(title, cards, onClickCard, clickableCardIds) =>
            openZoneAndCast(
              title,
              cards,
              (cardId) => {
                handleCastSpell(cardId);
                onClickCard(cardId);
              },
              clickableCardIds,
            )
          }
          onTargetFromZone={(cardId) => {
            closeZoneViewer();
            casting.wrappedTargetCard(cardId);
          }}
          onCastSpell={handleCastSpell}
          onTapLand={
            promptType === "chooseAction" ||
            promptType === "payCombatCost" ||
            promptType === "payManaCost"
              ? handleTapLand
              : undefined
          }
          onTapLands={
            promptType === "chooseAction" || promptType === "payManaCost"
              ? handleTapLands
              : undefined
          }
          onTapLandAbility={(cardId, abilityIndex, color, actionId) => {
            if (actionId) {
              respond({ type: "act", actionId });
            } else {
              respond({
                type: "tapForMana",
                cardId,
                abilityIndex: abilityIndex ?? undefined,
                color: color ?? undefined,
              });
            }
          }}
          onUntapLand={
            promptType === "chooseAction" ||
            promptType === "payCombatCost" ||
            promptType === "payManaCost"
              ? handleUntapLand
              : undefined
          }
          onUntapLands={
            promptType === "chooseAction" || promptType === "payManaCost"
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
        canRestoreSnapshots={(!isMultiplayer || isHost) && promptType === "chooseAction"}
        onRestoreSnapshot={restoreSnapshot}
      />

      {!manualApi && (
        <MainActionOverlay
          promptType={promptType}
          isWaitingForResponse={isWaitingForResponse}
          isAutoPassing={isAutoPassing}
          isPassingUntilEot={isPassingUntilEot}
          availableAttackerIds={chooseAttackersInput?.attackers.map((a) => a.attackerId) ?? []}
          pendingAttackers={pendingAttackers}
          onPassPriority={unifiedPass}
          onPassUntilEot={activatePassUntilEot}
          selectedAttackDefenderId={attackDefenderId}
          selectedAttackDefenderLabel={selectedAttackDefender?.label}
          multipleAttackDefenders={multipleAttackDefenders}
          onDeclareAttackers={(attackerIds, defenderId) =>
            respond(declareAttackersOutput(activePrompt, attackerIds, defenderId))
          }
          onBeginAttackTargetPick={selectAllAttackersForPick}
          pendingAttacker={pendingAttacker}
          pendingBlocker={pendingBlocker}
          blockError={blockError}
          blockRequirementError={blockRequirementError}
          attackerIds={chooseBlockersInput?.attackers.map((a) => a.attackerId) ?? []}
          blockAssignments={blockAssignments}
          onDeclareBlockers={(assignments) => respond({ type: "declareBlockers", assignments })}
          damageOrderCount={damageOrder.length}
          damageOrderTotal={damageOrderInput?.blockerIds.length ?? 0}
          onConfirmDamageOrder={() =>
            respond({ type: "damageAssignmentOrderDecision", orderedBlockerIds: damageOrder })
          }
          onUndoDamageOrder={undoDamageOrder}
          onDefaultDamageOrder={() =>
            respond({
              type: "damageAssignmentOrderDecision",
              orderedBlockerIds: damageOrderInput?.blockerIds ?? [],
            })
          }
          onOpenStack={() => setSpellStackModalOpen(true)}
          targetCompletionLabel={targetCompletion?.label}
          onCompleteTargets={targetCompletion?.onComplete}
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
            payManaCostInput
              ? {
                  cardName: payManaCostInput.cardName,
                  manaCost: payManaCostInput.manaCost,
                  manaPool: gameView.players.find((p) => p.isHuman)?.manaPool ?? {},
                  canConfirmFromPool: payManaCostInput.canConfirmFromPool,
                }
              : null
          }
          onPayManaCost={() => respond({ type: "payManaCost", auto: false })}
          onAutoManaCost={() => respond({ type: "payManaCost", auto: true })}
          onCancelManaCost={() => respond({ type: "cancelManaCost" })}
          mulliganCount={mulliganInput?.mulliganCount ?? 0}
          onMulliganKeep={() => respond({ type: "mulliganDecision", keep: true })}
          onMulliganDraw={() => respond({ type: "mulliganDecision", keep: false })}
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

      {promptType === "chooseBoardTargets" &&
        (boardTargets?.spellIds.length ?? 0) > 0 &&
        !spellStackModalOpen && (
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
        rightInsetExtra={
          boardArrangement === "perimeter" ? `${PERIMETER_SIDE_FRACTION * 100}%` : undefined
        }
        playerColorMap={playerColorMap}
        validSpellIds={boardTargets?.spellIds ?? []}
        onTargetSpell={(spellId) => {
          casting.wrappedTargetSpell(spellId);
          setSpellStackModalOpen(false);
        }}
      />

      <GameModals
        currentPrompt={activePrompt}
        sourceDeckCard={promptSourceDeckCard}
        viewingZone={viewingZone}
        onCloseZone={closeZone}
        libraryPeekModal={libraryPeekModal}
        onLibraryPeekConfirm={(selectedIds) => {
          if (libraryPeekModal!.mode === "discard")
            respond({ type: "chooseCardsDecision", chosenCardIds: selectedIds });
          else respond({ type: "digDecision", chosenCardIds: selectedIds });
          setLibraryPeekModal(null);
        }}
        spellStackModalOpen={spellStackModalOpen}
        stack={gameView.stack}
        validSpellIds={boardTargets?.spellIds ?? []}
        onTargetSpell={(spellId) => {
          casting.wrappedTargetSpell(spellId);
          setSpellStackModalOpen(false);
        }}
        onCloseStack={() => setSpellStackModalOpen(false)}
        playerColorMap={playerColorMap}
        abilityPickerState={abilityPickerState}
        onSelectAbility={(ability) => {
          respondHandAction(ability);
          closeAbilityPicker();
        }}
        onCancelAbilityPicker={closeAbilityPicker}
      />

      {playModePicker && (
        <PlayModePicker
          card={playModePicker.card}
          options={playModePicker.options}
          onSelect={(mode) => {
            const opt = playModePicker.options.find((o) => o.mode === mode);
            if (opt) respond({ type: "act", actionId: opt.actionId });
            closePlayModePicker();
          }}
          onCancel={closePlayModePicker}
        />
      )}

      <TargetingCursor
        active={targetingCursorActive}
        intent={casting.arrowIntent}
        hostile={casting.arrowHostile}
      />

      {draggingHandCard &&
        !draggingIsPermanent &&
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

      {preview.hoveredCard &&
        preview.hoveredCard.zoneId !== "hand" &&
        !draggingHandCard &&
        !viewingZone &&
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

      {interruption.waiting && (
        <WaitingForPlayerScreen
          reason={interruption.reason}
          secondsLeft={interruption.secondsLeft}
          disconnectedNames={interruption.disconnectedNames}
        />
      )}
    </div>
  );
}
