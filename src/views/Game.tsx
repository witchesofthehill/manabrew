import { useGameStore } from "@/stores/useGameStore";
import { useServerStore } from "@/stores/useServerStore";
import { asDeckCard } from "@/lib/decks";
import { GAME_CARD_DEFAULTS } from "@/lib/gameCard";
import { partitionBoardTargets, validCardIdsInCards } from "@/lib/boardTargets";
import { useGameUIStore } from "@/stores/useGameUIStore";
import { useKeybindings } from "@/hooks/useKeybindings";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useAutoResolvePrompt } from "@/components/prompts/internal/useAutoResolvePrompt";
import { useShallow } from "zustand/react/shallow";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CardDto, PlayerDto, StackObjectDto } from "@/protocol/game";
import { GameModals } from "@/components/game/GameModals";
import { LandscapeGate } from "@/components/LandscapeGate";
import { GameOverScreen } from "@/components/game/GameOverScreen";
import { GameLoadingScreen } from "@/components/game/GameLoadingScreen";
import { GameFailedScreen } from "@/components/game/GameFailedScreen";
import { WaitingForPlayerScreen } from "@/components/game/WaitingForPlayerScreen";
import { ManualTabletopControls } from "@/components/game/ManualTabletopControls";
import { MainActionOverlay, MiddleBarDock, RightActionPanel } from "@/components/game/panels";
import { ConcedeGameModal, EliminatedModal, LeaveGameModal } from "@/components/game/modals";
import type { StackSpec } from "@/pixi/stack/stack.types";
import { useCastingState } from "@/hooks/useCastingState";
import type { BoardScene } from "@/pixi/board/BoardScene";
import type { BoardCanvasLayout } from "@/pixi/BoardCanvas";
import { buildArrowSpecs } from "@/components/game/arrowSpecs";
import { getDisplayedManaAbilities } from "@/components/game/manaUtils";
import { PlayModePicker } from "@/components/game/PlayModePicker";
import { HAND_CARD_BASE } from "@/components/game/game.styles";
import { ACTION_DRAWER_BUMP_EVENT, ZONE_TILE_KEY } from "@/components/game/game.constants";
import { useHandScale } from "@/hooks/useHandScale";
import { useFlashQueue } from "@/hooks/useFlashQueue";
import { useHandDrag, type HandDragStart } from "@/hooks/useHandDrag";
import { useCardPreview } from "@/hooks/useCardPreview";
import { useMulliganSelection } from "@/hooks/useMulliganSelection";
import { HoverCardPreview } from "@/components/game/HoverCardPreview";
import { usePromptEffects } from "@/hooks/usePromptEffects";
import { useCombatState } from "@/hooks/useCombatState";
import { useGameEventListeners } from "@/hooks/useGameEventListeners";
import { useGamePrefetch } from "@/hooks/useGamePrefetch";
import { useMultiplayerInterruption } from "@/hooks/useMultiplayerInterruption";
import { GameBoard } from "@/components/game/GameBoard";
import { buildCombatRows } from "@/components/game/combatRows";
import { readableTextColor, withAlpha } from "@/themes/gameTheme";
import { useTheme } from "@/hooks/useTheme";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { useLimitedStore } from "@/stores/useLimitedStore";
import { tryConsumeGauntletMatch } from "@/lib/gauntletReturn";
import { intentPrefersArrow } from "@/types/promptType";
import type { PromptType } from "@/protocol";
import { declareAttackersOutput } from "@/components/prompts/internal/playerActions";
import { DamageOrderModal } from "@/components/prompts/DamageOrderModal";
import { TargetingCursor } from "@/components/game/TargetingCursor";
import { OPPONENT_SEATS } from "@/components/game/game.types";
import type { CombatPairing } from "@/components/game/game.types";
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

function buildDebugKeywordCard(controllerId: string, name: string, keywords: string[]): CardDto {
  return {
    ...GAME_CARD_DEFAULTS,
    id: DEBUG_KEYWORD_CARD_ID,
    identity: { name: name.trim() || "Raging Goblin", setCode: "", cardNumber: "", isToken: false },
    color: "R",
    manaCost: "{R}",
    cmc: 1,
    types: ["Creature"],
    power: "1",
    toughness: "1",
    text: "Dev debug card.",
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
  const rawGameView = useGameStore((s) => s.gameView);
  const myPlayerSlot = useGameStore((s) => s.myPlayerSlot);
  const currentPrompt = useGameStore((s) => s.currentPrompt);
  const isGameActive = useGameStore((s) => s.isGameActive);
  const isPrefetchingCards = useGameStore((s) => s.isPrefetchingCards);
  const isWaitingForResponse = useGameStore((s) => s.isWaitingForResponse);
  const relinquishedPriority = useGameStore((s) => s.relinquishedPriority);
  const gameLog = useGameStore((s) => s.gameLog);
  const snapshots = useGameStore((s) => s.snapshots);
  const debugInfo = useGameStore((s) => s.debugInfo);
  const fatalError = useGameStore((s) => s.fatalError);
  const isMultiplayer = useGameStore((s) => s.isMultiplayer);
  const isHost = useGameStore((s) => s.isHost);
  const selfConceded = useGameStore((s) => s.selfConceded);
  const gameView = useMemo(() => {
    if (!rawGameView || !selfConceded || !myPlayerSlot) return rawGameView;
    const self = rawGameView.players.find((p) => p.id === myPlayerSlot);
    if (!self || self.status !== "playing") return rawGameView;
    return {
      ...rawGameView,
      players: rawGameView.players.map((p) =>
        p.id === myPlayerSlot
          ? {
              ...p,
              status: "conceded" as const,
              hand: [],
              graveyard: [],
              exile: [],
              commandZone: [],
            }
          : p,
      ),
      battlefield: rawGameView.battlefield.filter((c) => c.controllerId !== myPlayerSlot),
    };
  }, [rawGameView, selfConceded, myPlayerSlot]);
  const hostingForgeRoom = useServerStore((s) => s.hostingForgeRoom);
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
  const zonePanelOrder = usePreferencesStore((s) => s.zonePanelOrder);
  const vScale = useHandScale();
  const themeColors = useTheme().gameTheme;
  const location = useLocation();
  const devExtraOpponents =
    (location.state as { devExtraOpponents?: number } | null)?.devExtraOpponents ?? 0;
  const containerRef = useRef<HTMLDivElement>(null);
  const boardSceneRef = useRef<BoardScene | null>(null);
  const [boardLayout, setBoardLayout] = useState<BoardCanvasLayout | null>(null);
  const [handCardLifted, setHandCardLifted] = useState(false);
  const [boardMenuOpen, setBoardMenuOpen] = useState(false);
  const [eliminatedModalOpen, setEliminatedModalOpen] = useState(false);
  const eliminatedModalShownRef = useRef(false);
  const [leaveGameModalOpen, setLeaveGameModalOpen] = useState(false);
  const [concedeModalOpen, setConcedeModalOpen] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  const handleLoadingComplete = useCallback(() => setIntroDone(true), []);
  const [boardSurfaceEl, setBoardSurfaceEl] = useState<HTMLDivElement | null>(null);

  const activePrompt = manualApi ? null : currentPrompt;
  const promptType = activePrompt?.input.type;
  const chooseActionInput = activePrompt?.input.type === "chooseAction" ? activePrompt.input : null;
  const chooseAttackersInput =
    activePrompt?.input.type === "chooseAttackers" ? activePrompt.input : null;
  const chooseBlockersInput =
    activePrompt?.input.type === "chooseBlockers" ? activePrompt.input : null;
  const damageOrderInput =
    activePrompt?.input.type === "chooseDamageAssignmentOrder" ? activePrompt.input : null;
  const payManaCostInput = activePrompt?.input.type === "payManaCost" ? activePrompt.input : null;
  const mulliganInput = activePrompt?.input.type === "mulligan" ? activePrompt.input : null;
  const promptActions = useMemo(
    () => chooseActionInput?.actions ?? payManaCostInput?.actions ?? [],
    [chooseActionInput, payManaCostInput],
  );
  const tappableLandIds = useMemo<string[]>(
    () =>
      promptActions.flatMap((a) =>
        a.type === "activateAbility" && a.isManaAbility ? [a.cardId] : [],
      ),
    [promptActions],
  );
  const untappableLandIds = useMemo<string[]>(
    () => promptActions.flatMap((a) => (a.type === "undoMana" ? [a.cardId] : [])),
    [promptActions],
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
    for (const a of promptActions) {
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
  }, [promptActions]);

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
    (card: CardDto): HandActionOption[] => {
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
    (card: CardDto): HandActionOption[] => castOptionsByCardId.get(card.id) ?? [],
    [castOptionsByCardId],
  );

  const getHandActionOptions = useCallback(
    (card: CardDto): HandActionOption[] =>
      manualApi
        ? getManualCardActions(card)
        : [...castOptions(card), ...(abilitiesByCardId.get(card.id) ?? [])],
    [manualApi, getManualCardActions, castOptions, abilitiesByCardId],
  );

  const getBattlefieldAbilityOptions = useCallback(
    (card: CardDto): HandActionOption[] => abilitiesByCardId.get(card.id) ?? [],
    [abilitiesByCardId],
  );

  const getCardActions = useCallback(
    (card: CardDto): HandActionOption[] => {
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

  const handleHandCardAction = (card: CardDto, e?: { clientX: number; clientY: number }) => {
    if (manualApi) {
      preview.showSticky(card, e?.clientX, e?.clientY);
      return;
    }
    const actions = getHandActionOptions(card);
    if (actions.length === 0) {
      if (playableIds.has(card.id)) {
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

  const handleHandCardDragStart = (card: CardDto, e: HandDragStart) => {
    if (manualApi) {
      preview.showSticky(card, e.clientX, e.clientY);
      return;
    }
    const actions = getHandActionOptions(card);
    if (actions.length > 1 || actions.some((action) => action.kind === "ability")) {
      handleHandCardAction(card, e);
      return;
    }
    if (playableIds.has(card.id)) startHandCardDrag(card, e);
  };

  const handleBattlefieldCardAction = (card: CardDto, e?: React.MouseEvent) => {
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
    attackAssignments,
    submitAttack,
    pendingAttacker,
    pendingBlocker,
    attackDefenderId,
    blockAssignments,
    blockError,
    blockRequirement,
    assignBlockPair,
    unassignBlock,
    assignAttackPair,
    unassignAttack,
    damageOrder,
    toggleDamageOrder,
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
  const blockRequirementError = useMemo<string | null>(() => {
    if (!blockRequirement) return null;
    const name =
      gameView?.battlefield.find((c) => c.id === blockRequirement.attackerId)?.identity.name ??
      "This attacker";
    const creatures = (n: number) => `${n} ${n === 1 ? "creature" : "creatures"}`;
    return blockRequirement.kind === "min"
      ? `${name} must be blocked by ${creatures(blockRequirement.count)} (${blockRequirement.assigned} assigned).`
      : `${name} can be blocked by at most ${creatures(blockRequirement.count)} (${blockRequirement.assigned} assigned).`;
  }, [blockRequirement, gameView?.battlefield]);
  const mustAttackHint = useMemo<string | null>(() => {
    const must = chooseAttackersInput?.attackers.filter((a) => a.mustAttack) ?? [];
    if (must.length === 0) return null;
    const nameOf = (id: string) =>
      gameView?.battlefield.find((c) => c.id === id)?.identity.name ?? "A creature";
    return `Must attack if able — ${must.map((a) => nameOf(a.attackerId)).join(", ")}`;
  }, [chooseAttackersInput, gameView?.battlefield]);
  const blockRestrictionHint = useMemo<string | null>(() => {
    const attackers = chooseBlockersInput?.attackers ?? [];
    const nameOf = (id: string) =>
      gameView?.battlefield.find((c) => c.id === id)?.identity.name ?? "An attacker";
    const parts: string[] = [];
    const menace = attackers.filter(
      (a) => a.minBlockers > 1 && a.validBlockerIds.length >= a.minBlockers,
    );
    if (menace.length > 0) {
      parts.push(
        `Requires multiple blockers — ${menace
          .map((a) => `${nameOf(a.attackerId)} (needs ${a.minBlockers})`)
          .join(", ")}`,
      );
    }
    const mustBlock = attackers.filter((a) => a.mustBeBlocked && a.validBlockerIds.length > 0);
    if (mustBlock.length > 0) {
      parts.push(`Must be blocked — ${mustBlock.map((a) => nameOf(a.attackerId)).join(", ")}`);
    }
    return parts.length > 0 ? parts.join(" · ") : null;
  }, [chooseBlockersInput, gameView?.battlefield]);
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
    cards: CardDto[],
    onClickCard?: (cardId: string) => void,
    clickableCardIds?: string[],
    targetHostile?: boolean,
  ) {
    const stickyPromptType =
      onClickCard && currentPrompt?.input.type === "chooseBoardTargets"
        ? "chooseBoardTargets"
        : undefined;
    openZoneViewer({
      title,
      cards,
      onClickCard,
      clickableCardIds,
      targetHostile,
      stickyPromptType,
    });
  }
  function openManualZone(title: string, cards: CardDto[]) {
    openZoneViewer({
      title,
      cards,
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
    cards: CardDto[],
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

  const handleTapLand = (card: CardDto) => {
    const manaAbilities = manaAbilitiesByCardId.get(card.id) ?? [];
    if (manaAbilities.length > 1) {
      preview.showSticky(card);
      return;
    }
    if (manaAbilities.length === 1) {
      const actionId = manaAbilities[0].actionId;
      if (actionId) respond({ type: "act", actionId });
      return;
    }

    const cardActions = promptActions.filter(
      (a) => a.type === "activateAbility" && a.cardId === card.id,
    );
    if (cardActions.length > 1) {
      preview.showSticky(card);
    } else if (cardActions.length === 1) {
      respond({ type: "act", actionId: cardActions[0].id });
    }
  };

  const handleUntapLand = (card: CardDto) => {
    const undo = promptActions.find((a) => a.type === "undoMana" && a.cardId === card.id);
    if (undo) respond({ type: "act", actionId: undo.id });
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
      return;
    }
    const action = promptActions.find(
      (a) => a.type === "activateAbility" && a.isManaAbility && a.cardId === id,
    );
    if (action) respond({ type: "act", actionId: action.id });
  };
  const untapResponse = (id: string) => {
    const a = promptActions.find((x) => x.type === "undoMana" && x.cardId === id);
    if (a) respond({ type: "act", actionId: a.id });
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
  const { unifiedPass, spellStackModalOpen, setSpellStackModalOpen } = usePromptEffects({
    currentPrompt: activePrompt,
    gameView,
    isWaitingForResponse,
    respond,
    myPlayerId: _earlyMyPlayerId,
  });

  const passPriority = useCallback(() => {
    window.dispatchEvent(new Event(ACTION_DRAWER_BUMP_EVENT));
    unifiedPass();
  }, [unifiedPass]);
  const unifiedPassRef = useRef(passPriority);
  unifiedPassRef.current = passPriority;
  const payManaPrimaryRef = useRef(() => {});
  payManaPrimaryRef.current = () => {
    if (promptType !== "payManaCost") return;
    if (activePrompt?.input.canConfirmFromPool) {
      respond({ type: "pay", auto: false });
    } else {
      respond({ type: "pay", auto: true });
    }
  };
  const confirmPromptRef = useRef<() => boolean>(() => false);
  confirmPromptRef.current = () => {
    // A response is already in flight — ignore the keyboard confirm so it can't
    // fire submitAttack (which would clear staging while respond() is dropped).
    if (isWaitingForResponse) return false;
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
      if (attackAssignments.length === 0 && pendingAttackers.length === 0) return false;
      // submitAttack merges drag-declared assignments with any still-pending
      // (tapped) attackers, so both flows commit regardless of defender count.
      submitAttack();
      return true;
    }
    if (promptType === "chooseBlockers") {
      if (blockAssignments.length === 0 || blockRequirement) return false;
      respond({ type: "declareBlockers", assignments: blockAssignments });
      return true;
    }
    return false;
  };

  const preview = useCardPreview([viewingZone, spellStackModalOpen, abilityPickerState]);

  const battlefieldContainerRef = useRef<HTMLDivElement>(null);
  const { draggingHandCard, ghostPos, isOverBattlefield, startHandCardDrag } = useHandDrag({
    battlefieldContainerRef,
    handDropExclusionPx: Math.round(HAND_CARD_BASE.containerH * vScale * 0.35),
    onCastSpell: handleCastSpell,
    dismissHover: preview.dismiss,
    onLongPress: (card, pos) => preview.showSticky(card, pos.x, pos.y),
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

  useKeybindings({
    "toggle-stack": () => useStackUIStore.getState().toggleCollapsed(),
    "open-dev-panel": () => useGameUIStore.getState().openDevPanel(),
    "pass-priority": () => {
      if (manualApi) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (confirmPromptRef.current()) return;
      if (promptType === "chooseAction") unifiedPassRef.current();
    },
  });

  const me =
    gameView?.players?.find((p) => p.id === myPlayerSlot) ??
    gameView?.players?.find((p) => p.isHuman) ??
    gameView?.players?.[0];
  const opponents = useMemo(
    () => gameView?.players?.filter((p) => p.id !== me?.id) ?? [],
    [gameView?.players, me?.id],
  );

  const iAmEliminated = selfConceded || (me != null && me.status !== "playing");
  const ownsEngine = isHost || hostingForgeRoom;
  // With fewer than two other players left, my elimination ends the game —
  // GameOverScreen takes over, so the observe-or-leave modal would only flash.
  const gameContinuesWithoutMe = opponents.filter((p) => p.status === "playing").length >= 2;
  const handleConcede = useCallback(() => setConcedeModalOpen(true), []);
  const handleConcedeConfirm = useCallback(() => {
    setConcedeModalOpen(false);
    void concede();
    if (ownsEngine) eliminatedModalShownRef.current = true;
  }, [concede, ownsEngine]);
  const handleLeave = useCallback(() => {
    if (ownsEngine) setLeaveGameModalOpen(true);
    else void endGame();
  }, [ownsEngine, endGame]);

  const myStatus = me?.status;
  const gameOverNow = gameView?.gameOver ?? false;
  useEffect(() => {
    if (gameOverNow || manualApi || !gameContinuesWithoutMe) return;
    if (myStatus && myStatus !== "playing" && !eliminatedModalShownRef.current) {
      eliminatedModalShownRef.current = true;
      setEliminatedModalOpen(true);
    }
  }, [myStatus, gameOverNow, manualApi, gameContinuesWithoutMe]);

  const payManaCostPrompt =
    currentPrompt?.input.type === "payManaCost" ? currentPrompt.input : null;
  const delveActionIdByCardId = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of payManaCostPrompt?.actions ?? []) {
      if (a.type === "delve" || a.type === "undelve") map.set(a.cardId, a.id);
    }
    return map;
  }, [payManaCostPrompt]);
  const delveSourceIds = useMemo(() => [...delveActionIdByCardId.keys()], [delveActionIdByCardId]);
  const delvedCardIds = useMemo(
    () => payManaCostPrompt?.actions.flatMap((a) => (a.type === "undelve" ? [a.cardId] : [])) ?? [],
    [payManaCostPrompt],
  );

  const handleDelveCard = useCallback(
    (cardId: string) => {
      if (useGameStore.getState().isWaitingForResponse) return;
      const actionId = delveActionIdByCardId.get(cardId);
      if (actionId) respond({ type: "act", actionId });
    },
    [respond, delveActionIdByCardId],
  );

  const openDelveZone = useCallback(() => {
    openZoneViewer({
      title: "Delve — Your Graveyard",
      cards: me?.graveyard ?? [],
      onClickCard: handleDelveCard,
      clickableCardIds: delveSourceIds,
      selectedCardIds: delvedCardIds,
      clickLabel: "DELVE",
      selectedLabel: "UN-DELVE",
      stickyPromptType: "payManaCost",
    });
  }, [openZoneViewer, me?.graveyard, handleDelveCard, delveSourceIds, delvedCardIds]);

  useEffect(() => {
    const vz = useGameUIStore.getState().viewingZone;
    if (vz?.selectedCardIds === undefined) return;
    openZoneViewer({ ...vz, clickableCardIds: delveSourceIds, selectedCardIds: delvedCardIds });
  }, [delveSourceIds, delvedCardIds, openZoneViewer]);

  // Keep an open zone-target viewer in sync with the live valid set as each
  // target is picked (the engine re-prompts with the remaining candidates).
  // `boardTargets` is null while a response is in flight — leave the viewer be;
  // if targeting is active but no longer has zone candidates, close it.
  useEffect(() => {
    const vz = useGameUIStore.getState().viewingZone;
    if (vz?.stickyPromptType !== "chooseBoardTargets" || !boardTargets) return;
    if (!boardTargets.zone) {
      closeZoneViewer();
      return;
    }
    const clickableCardIds = validCardIdsInCards(boardTargets.zone.validCardIds, vz.cards);
    if (clickableCardIds.length === 0) {
      closeZoneViewer();
      return;
    }
    openZoneViewer({ ...vz, clickableCardIds });
  }, [boardTargets, openZoneViewer, closeZoneViewer]);

  // Generic sticky-viewer close: a viewer bound to a prompt type stays open
  // across same-type re-prompts and only closes once the prompt changes type
  // or ends. Keyed on currentPrompt (not activePrompt) so it survives the null
  // window while a response is in flight.
  useEffect(() => {
    const sticky = viewingZone?.stickyPromptType;
    if (sticky && currentPrompt?.input.type !== sticky) {
      closeZoneViewer();
    }
  }, [currentPrompt, viewingZone, closeZoneViewer]);
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
            status: "playing",
            isHuman: false,
            life: 20,
            poison: 0,
            hand: [],
            graveyard: [],
            exile: [],
            commandZone: [],
            libraryCount: 40,
            manaPool: {} as Record<string, number>,
            commanderDamage: {},
            energyCounters: 0,
            radiationCounters: 0,
            hasCityBlessing: false,
            ringLevel: 0,
            speed: 0,
            experienceCounters: 0,
            ticketCounters: 0,
          }) as PlayerDto,
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

  const combatRows = useMemo(
    () =>
      gameView
        ? buildCombatRows({
            battlefield: gameView.battlefield,
            combatAssignments: [
              ...combatAssignments,
              ...blockAssignments.filter(
                (b) => !combatAssignments.some((c) => c.blockerId === b.blockerId),
              ),
            ],
            playerIds: gameView.players.map((p) => p.id),
            pendingAttacks: attackAssignments,
          })
        : [],
    [gameView, combatAssignments, blockAssignments, attackAssignments],
  );
  const oppCombatAttackerIds = useMemo(
    () => new Set(combatRows.flatMap((r) => r.attackerIds)),
    [combatRows],
  );

  const hoveredStackObjectIdForSpecs = useStackUIStore((s) => s.hoveredStackObjectId);
  const setHoveredStackObjectId = useStackUIStore((s) => s.setHoveredStackObjectId);
  const stackCollapsed = useStackUIStore((s) => s.collapsed);
  const toggleStackCollapsed = useStackUIStore((s) => s.toggleCollapsed);
  const activeAttackers = useMemo(
    () =>
      (gameView?.battlefield ?? [])
        .filter((c) => c.isAttacking && c.attackingPlayerId)
        .map((c) => ({ attackerId: c.id, defenderId: c.attackingPlayerId! })),
    [gameView?.battlefield],
  );

  const combatPairings = useMemo<CombatPairing[]>(() => {
    const nameOf = (id: string) =>
      id === myPlayerSlot
        ? "You"
        : (gameView?.players?.find((p) => p.id === id)?.name ?? "A player");
    const pairs = new Map<string, CombatPairing>();
    for (const c of gameView?.battlefield ?? []) {
      if (!c.isAttacking || !c.attackingPlayerId) continue;
      const key = `${c.controllerId}->${c.attackingPlayerId}`;
      const existing = pairs.get(key);
      if (existing) existing.count += 1;
      else
        pairs.set(key, {
          key,
          attacker: nameOf(c.controllerId),
          defender: nameOf(c.attackingPlayerId),
          count: 1,
        });
    }
    return [...pairs.values()];
  }, [gameView?.battlefield, gameView?.players, myPlayerSlot]);

  const cardZoneTiles = useMemo(() => {
    const map = new Map<string, { playerId: string; key: string }>();
    for (const p of gameView?.players ?? []) {
      for (const c of p.graveyard) map.set(c.id, { playerId: p.id, key: ZONE_TILE_KEY.graveyard });
      for (const c of p.exile) map.set(c.id, { playerId: p.id, key: ZONE_TILE_KEY.exile });
      for (const c of p.commandZone) map.set(c.id, { playerId: p.id, key: ZONE_TILE_KEY.command });
    }
    return map;
  }, [gameView?.players]);

  const attackTargetKindById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of chooseAttackersInput?.attackTargets ?? []) m.set(t.id, t.kind);
    return m;
  }, [chooseAttackersInput]);
  const attackArrows = useMemo(
    () => [
      ...activeAttackers
        .filter((a) => !oppCombatAttackerIds.has(a.attackerId))
        .map((a) => ({
          attackerId: a.attackerId,
          targetId: a.defenderId,
          targetKind: "player" as const,
        })),
      // Player attacks read from the attack-row staging; only planeswalker /
      // battle attacks draw an arrow, pointing at the specific permanent. This
      // only covers the pre-commit declaration — a committed planeswalker/battle
      // arrow would need the engine to populate CardDto.attackTargetId (always
      // None today), so it's intentionally not attempted here.
      ...attackAssignments
        .filter((a) => {
          const kind = attackTargetKindById.get(a.targetId);
          return kind === "planeswalker" || kind === "battle";
        })
        .map((a) => ({
          attackerId: a.attackerId,
          targetId: a.targetId,
          targetKind: "card" as const,
        })),
    ],
    [activeAttackers, attackAssignments, oppCombatAttackerIds, attackTargetKindById],
  );
  const arrowBlocks = useMemo(
    () => combatAssignments.filter((a) => !oppCombatAttackerIds.has(a.attackerId)),
    [combatAssignments, oppCombatAttackerIds],
  );

  const liveArrowSpecs = useMemo(
    () =>
      buildArrowSpecs({
        promptType,
        attackerIds,
        blockAssignments,
        combatAssignments: arrowBlocks,
        activeAttackers: attackArrows,
        stack: gameView?.stack ?? [],
        activeStackObjectId: hoveredStackObjectIdForSpecs,
        stageBlockers: true,
        cardZoneTiles,
      }),
    [
      promptType,
      attackerIds,
      blockAssignments,
      arrowBlocks,
      attackArrows,
      gameView?.stack,
      hoveredStackObjectIdForSpecs,
      cardZoneTiles,
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
    if (!gameView) return new Map<string, CardDto>();
    const cards: CardDto[] = [
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

  const regionOwnerOf = useCallback((card: CardDto, byId: Map<string, CardDto>): string => {
    let cur = card;
    const seen = new Set<string>();
    while (cur.attachedTo && byId.has(cur.attachedTo) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.attachedTo)!;
    }
    return cur.controllerId;
  }, []);

  const battlefieldById = useMemo(() => {
    const m = new Map<string, CardDto>();
    for (const c of gameView?.battlefield ?? []) m.set(c.id, c);
    return m;
  }, [gameView?.battlefield]);

  const myPermanents = useMemo<CardDto[]>(() => {
    if (!gameView || !me) return [];
    const pendingSet = new Set([
      ...pendingAttackers,
      ...attackAssignments.map((a) => a.attackerId),
    ]);
    const list = gameView.battlefield
      .filter((c) => regionOwnerOf(c, battlefieldById) === me.id)
      .map((c) =>
        pendingSet.has(c.id) && !c.keywords.includes("Vigilance") ? { ...c, tapped: true } : c,
      );
    if (debugCardEnabled) {
      list.push(buildDebugKeywordCard(me.id, debugCardName, debugBattlefieldKeywords));
    }
    return list;
  }, [
    gameView,
    me,
    pendingAttackers,
    attackAssignments,
    debugCardEnabled,
    debugCardName,
    debugBattlefieldKeywords,
    regionOwnerOf,
    battlefieldById,
  ]);

  const opponentPermanentsByPlayer = useMemo(() => {
    const map = new Map<string, CardDto[]>();
    if (!gameView) return map;
    for (const op of opponents) {
      map.set(
        op.id,
        gameView.battlefield.filter((c) => regionOwnerOf(c, battlefieldById) === op.id),
      );
    }
    return map;
  }, [gameView, opponents, regionOwnerOf, battlefieldById]);

  const stackCardsBySourceId = useMemo(() => {
    const byId = new Map<string, CardDto>();
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
      useDelay?: boolean;
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
    preview.handleMouseEnter(card, e, { useDelay: true, ...options });
  };

  const handleHoverCardGuarded = (
    card: CardDto | null,
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
      byId.set(c.id, c.identity.name);
    }
    for (const [sourceId, c] of stackCardsBySourceId.entries()) {
      if (!byId.has(sourceId)) byId.set(sourceId, c.identity.name);
    }
    return byId;
  }, [visibleCardsById, stackCardsBySourceId]);

  const playerNameById = useMemo(
    () => new Map((gameView?.players ?? []).map((p) => [p.id, p.name] as const)),
    [gameView?.players],
  );

  const resolveStackCard = (stackItem: StackObjectDto): CardDto =>
    visibleCardsById.get(stackItem.sourceId) ?? stackCardsBySourceId.get(stackItem.sourceId)!;

  const activeFlashCard: CardDto | null = useMemo(() => {
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

  if (fatalError) {
    return <GameFailedScreen message={fatalError} onLeave={endGame} />;
  }

  if (!gameView || isPrefetchingCards || !me || !introDone) {
    return <GameLoadingScreen debugInfo={debugInfo} onComplete={handleLoadingComplete} />;
  }

  const playableIds = new Set<string>(
    promptType === "chooseAction"
      ? (chooseActionInput?.actions ?? []).flatMap((a) =>
          a.type === "cast" || a.type === "activateAbility" ? [a.cardId] : [],
        )
      : [],
  );

  if (gameView.gameOver || promptType === "gameOver") {
    return (
      <GameOverScreen
        winnerId={gameView.winnerId}
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

  const stackValidTargetSet = new Set(boardTargets?.spellIds ?? []);
  const stackTargetingActive = stackValidTargetSet.size > 0;
  const stackSpec: StackSpec = {
    cards: (gameView?.stack ?? []).map((obj, idx, arr) => {
      const isValidTarget = stackTargetingActive && stackValidTargetSet.has(obj.id);
      return {
        id: obj.id,
        sourceId: obj.sourceId,
        card: resolveStackCard(obj),
        controllerId: obj.controllerId,
        isCasting: obj.isCasting,
        isTopOfStack: idx === arr.length - 1,
        seatColor: playerColorMap.get(obj.controllerId),
        isValidTarget,
        isDimmed: stackTargetingActive && !isValidTarget,
      };
    }),
    flash:
      shouldRenderStackFlashCard && activeFlashCard && activeFlash
        ? {
            token: `${activeFlash.cardId}:${activeFlash.cardName}:${activeFlash.setCode}`,
            card: activeFlashCard,
          }
        : null,
    showPreStackFlash: shouldShowPreStackFlash,
    collapsed: stackCollapsed,
  };

  return (
    <div
      ref={containerRef}
      className="font-game game-touch-surface relative flex flex-col h-full min-h-0 overflow-hidden select-none"
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
      <LandscapeGate />
      <div className="flex min-h-0 flex-1 overflow-visible">
        <GameBoard
          boardSceneRef={boardSceneRef}
          onLayoutChange={setBoardLayout}
          boardSurfaceRef={setBoardSurfaceEl}
          stackSpec={stackSpec}
          onOpenStack={() => setSpellStackModalOpen(true)}
          onTargetSpell={(spellId) => {
            casting.wrappedTargetSpell(spellId);
            setSpellStackModalOpen(false);
          }}
          onHoverStack={setHoveredStackObjectId}
          onToggleStack={toggleStackCollapsed}
          handSelectionMode={mulliganPutBack.active}
          handSelectedIds={mulliganPutBack.selected}
          onHandCardToggle={mulliganPutBack.toggle}
          me={me}
          opponents={displayOpponents}
          myPermanents={myPermanents}
          opponentPermanentsByPlayer={opponentPermanentsByPlayer}
          myHand={me?.hand ?? []}
          graveyard={me?.graveyard ?? []}
          exile={me?.exile ?? []}
          myCommandZone={me?.commandZone ?? []}
          playableIds={playableIds}
          activePlayerId={gameView.activePlayerId}
          priorityPlayerId={effectivePriorityHighlightPlayerId}
          monarchId={gameView.monarchId ?? null}
          initiativeHolderId={gameView.initiativeHolderId ?? null}
          step={gameView.step}
          promptType={promptType}
          currentPrompt={activePrompt}
          boardTargets={boardTargets}
          pendingAttackers={pendingAttackers}
          attackAssignments={attackAssignments}
          pendingAttacker={pendingAttacker}
          pendingBlocker={pendingBlocker}
          damageOrder={damageOrder}
          damageOrderBlockerIds={damageOrderInput?.blockerIds ?? []}
          selectedAttackDefenderId={attackDefenderId}
          blockAssignments={blockAssignments}
          combatAssignments={combatAssignments}
          combatRows={combatRows}
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
          onLongPressCard={(card, rect) =>
            preview.showSticky(card, rect.left + rect.width / 2, rect.top + rect.height / 2)
          }
          onHandHoverChange={setHandCardLifted}
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
          onAssignAttacker={assignAttackPair}
          onUnassignAttacker={unassignAttack}
          onTargetPlayer={handleTargetPlayer}
          onShowBoardMenu={() => setBoardMenuOpen(true)}
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
                const card = cards.find((c) => c.id === cardId);
                if (card) handleHandCardAction(card);
                else handleCastSpell(cardId);
                onClickCard(cardId);
              },
              clickableCardIds,
            )
          }
          delveAvailable={delveSourceIds.length > 0}
          onOpenDelveZone={openDelveZone}
          onTargetFromZone={(cardId) => {
            casting.wrappedTargetCard(cardId);
          }}
          onCastSpell={handleCastSpell}
          onTapLand={
            promptType === "chooseAction" || promptType === "payManaCost"
              ? handleTapLand
              : undefined
          }
          onTapLands={
            promptType === "chooseAction" || promptType === "payManaCost"
              ? handleTapLands
              : undefined
          }
          onTapLandAbility={(actionId) => {
            if (actionId) respond({ type: "act", actionId });
          }}
          onUntapLand={
            promptType === "chooseAction" || promptType === "payManaCost"
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

      {boardSurfaceEl &&
        createPortal(
          !manualApi && (
            <>
              <MainActionOverlay
                promptType={promptType}
                isWaitingForResponse={isWaitingForResponse}
                isWaitingForOthers={
                  relinquishedPriority ||
                  (isWaitingForResponse && gameView.priorityPlayerId !== me.id)
                }
                availableAttackerIds={
                  chooseAttackersInput?.attackers.map((a) => a.attackerId) ?? []
                }
                pendingAttackers={pendingAttackers}
                onPassPriority={passPriority}
                selectedAttackDefenderId={attackDefenderId}
                multipleAttackDefenders={multipleAttackDefenders}
                onDeclareAttackers={(attackerIds, defenderId) =>
                  respond(declareAttackersOutput(activePrompt, attackerIds, defenderId))
                }
                onBeginAttackTargetPick={selectAllAttackersForPick}
                attackAssignmentCount={attackAssignments.length}
                mustAttackHint={mustAttackHint}
                onSubmitAttack={submitAttack}
                pendingAttacker={pendingAttacker}
                pendingBlocker={pendingBlocker}
                blockError={blockError}
                blockRequirementError={blockRequirementError}
                blockRestrictionHint={blockRestrictionHint}
                attackerIds={chooseBlockersInput?.attackers.map((a) => a.attackerId) ?? []}
                blockAssignments={blockAssignments}
                combatPairings={combatPairings}
                onDeclareBlockers={(assignments) =>
                  respond({ type: "declareBlockers", assignments })
                }
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
                resolveCardName={(cardId) => cardNameById.get(cardId) ?? cardId}
                resolveCard={(cardId) => visibleCardsById.get(cardId)}
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
                        description: payManaCostInput.description,
                        manaPool: gameView.players.find((p) => p.isHuman)?.manaPool ?? {},
                        canConfirmFromPool: payManaCostInput.canConfirmFromPool,
                        delveCount: delvedCardIds.length,
                        delveAvailable: delveSourceIds.length > 0,
                        onOpenDelve: openDelveZone,
                      }
                    : null
                }
                onPayManaCost={() => respond({ type: "pay", auto: false })}
                onAutoManaCost={() => respond({ type: "pay", auto: true })}
                onCancelManaCost={() => respond({ type: "cancel" })}
                mulliganCount={mulliganInput?.mulliganCount ?? 0}
                onMulliganKeep={() => respond({ type: "mulliganDecision", keep: true })}
                onMulliganDraw={() => respond({ type: "mulliganDecision", keep: false })}
                mulliganPutBackCount={mulliganPutBack.count}
                mulliganSelectedCount={mulliganPutBack.selected.size}
                onMulliganPutBackConfirm={mulliganPutBack.confirm}
                selfClusterMaxHeight={boardLayout?.selfClusterMaxHeight}
                dividerY={boardLayout?.dividerY}
                dimmed={handCardLifted}
              />
              <MiddleBarDock
                open={boardMenuOpen}
                onOpenChange={setBoardMenuOpen}
                onConcede={handleConcede}
                eliminated={iAmEliminated}
                onLeave={handleLeave}
                sidePanelCollapsed={isActionPanelCollapsed}
                onToggleSidePanel={toggleActionPanel}
                players={gameView.players.map((p) => {
                  const color = playerColorMap.get(p.id) ?? themeColors.playerColors.self;
                  return {
                    id: p.id,
                    name: p.name,
                    color,
                    textColor: readableTextColor(
                      color,
                      themeColors.canvas.shadow,
                      themeColors.textOnTinted,
                    ),
                  };
                })}
              />
            </>
          ),
          boardSurfaceEl,
        )}

      {eliminatedModalOpen && (
        <EliminatedModal
          heading={selfConceded || me?.status === "conceded" ? "You conceded" : "You lost"}
          hosting={ownsEngine}
          onObserve={() => setEliminatedModalOpen(false)}
          onLeave={() => {
            setEliminatedModalOpen(false);
            void endGame();
          }}
        />
      )}
      {leaveGameModalOpen && (
        <LeaveGameModal
          onStay={() => setLeaveGameModalOpen(false)}
          onLeave={() => {
            setLeaveGameModalOpen(false);
            void endGame();
          }}
        />
      )}
      {concedeModalOpen && (
        <ConcedeGameModal
          onConfirm={handleConcedeConfirm}
          onCancel={() => setConcedeModalOpen(false)}
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

      {gameView.step === "first_strike_damage" && (
        <div className="pointer-events-none absolute top-4 left-1/2 z-50 -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/90 px-4 py-2 shadow-lg backdrop-blur">
            <span className="text-sm font-semibold tracking-wide">First Strike Damage</span>
            <span className="text-xs text-muted-foreground">
              only first &amp; double strikers deal damage now
            </span>
          </div>
        </div>
      )}

      <GameModals
        currentPrompt={activePrompt}
        sourceDeckCard={promptSourceDeckCard}
        viewingZone={viewingZone}
        onCloseZone={closeZone}
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

      {damageOrderInput && (
        <DamageOrderModal
          attackerName={
            gameView.battlefield.find((c) => c.id === damageOrderInput.attackerId)?.identity.name ??
            "The attacker"
          }
          blockerCards={damageOrderInput.blockerCards}
          order={damageOrder}
          isWaiting={isWaitingForResponse}
          onToggle={toggleDamageOrder}
          onUndo={undoDamageOrder}
          onAuto={() =>
            respond({
              type: "damageAssignmentOrderDecision",
              orderedBlockerIds: damageOrderInput.blockerIds,
            })
          }
          onConfirm={() =>
            respond({ type: "damageAssignmentOrderDecision", orderedBlockerIds: damageOrder })
          }
        />
      )}

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
