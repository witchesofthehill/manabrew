import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CardDto, PlayerDto } from "@/protocol/game";
import type { Prompt } from "@/protocol";
import type { BoardTargetBuckets } from "@/lib/boardTargets";
import { type ZonePanelItem } from "@/stores/usePreferencesStore";
import { BoardCanvas, type BoardCanvasLayout, type BoardCanvasRegion } from "@/pixi/BoardCanvas";
import { BoardArrowsCanvas } from "@/pixi/BoardArrowsCanvas";
import { isFeatureEnabled } from "@/featureFlags";
import type { BoardScene } from "@/pixi/board/BoardScene";
import type { PlayerBarSpec, PlayerZoneSpec } from "@/pixi/board/PlayerBarLayer";
import type { BlockingRect } from "@/pixi/board/types";
import { PLAYMAT_PADDING } from "@/pixi/board/PlaymatLayer";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useGameStore } from "@/stores/useGameStore";
import { useServerStore } from "@/stores/useServerStore";
import type { ArrowSpec, BattlefieldState, GameCanvasCallbacks, ScreenBounds } from "@/pixi/types";
import { usePhaseStopStore } from "@/stores/usePhaseStopStore";
import type { PromptType } from "@/protocol";
import { PlayerPanel } from "@/components/game/panels";
import { OPPONENT_SEATS } from "@/components/game/game.types";
import { useTheme } from "@/hooks/useTheme";
import { withAlpha } from "@/themes/gameTheme";
import { manaAbilityInfos } from "@/components/game/game.utils";
import { useHandScale } from "@/hooks/useHandScale";
import { HAND_CARD_BASE } from "@/components/game/game.styles";
import { GAP } from "@/pixi/constants";
import { computeBaseLayout, HAND_FAN_PARAMS } from "@/pixi/HandLayout";
import type { HandActionOption } from "@/stores/useGameUIStore";
import { ReconnectBanner } from "@/components/lobby/ReconnectBanner";

function promptOf<TType extends PromptType>(
  prompt: Prompt | null | undefined,
  type: TType,
): Extract<Prompt, { input: { type: TType } }> | null {
  return prompt?.input.type === type
    ? (prompt as Extract<Prompt, { input: { type: TType } }>)
    : null;
}

const SELF_PANEL_SCALE = 0.85;
const UNIFIED_OPPONENT_PANEL_SCALE = 0.72;

interface GameBoardProps {
  me: PlayerDto;
  opponents: PlayerDto[];
  myPermanents: CardDto[];
  opponentPermanentsByPlayer: Map<string, CardDto[]>;
  myHand: CardDto[];
  graveyard: CardDto[];
  exile: CardDto[];
  myCommandZone?: CardDto[];
  /** Ids of cards the active `chooseAction` prompt offers to cast/activate. */
  playableIds: Set<string>;
  activePlayerId: string;
  priorityPlayerId: string;
  step: string;

  promptType?: PromptType;
  currentPrompt: Prompt | null;
  boardTargets: BoardTargetBuckets | null;

  pendingAttackers: string[];
  pendingAttacker?: string | null;
  pendingBlocker?: string | null;
  damageOrder?: string[];
  damageOrderBlockerIds?: string[];
  selectedAttackDefenderId?: string | null;
  blockAssignments: { blockerId: string; attackerId: string }[];
  combatAssignments?: { blockerId: string; attackerId: string }[];
  arrowSpecs?: ArrowSpec[];
  castingArrow?: { sourceCardId: string; hostile: boolean } | null;
  playerIsTargetable: (playerId: string) => boolean;

  monarchId?: string | null;
  initiativeHolderId?: string | null;

  turnFlashPlayerId: string | null;

  zonePanelOrder: ZonePanelItem[];

  isOverBattlefield: boolean;
  draggingCardId?: string;
  draggingIsPermanent?: boolean;
  castingCardId?: string | null;

  onHandCardDragStart: (card: CardDto, e: React.MouseEvent) => void;
  onHandCardClick: (card: CardDto, e?: React.MouseEvent) => void;
  onHoverCard: (
    card: CardDto | null,
    e?: React.MouseEvent,
    options?: { useAnchor?: boolean; placement?: "auto" | "top-center"; anchorOverride?: DOMRect },
  ) => void;
  onDismissHoverPreview?: () => void;
  getHandActions?: (card: CardDto) => HandActionOption[];
  onSelectHandAction?: (action: HandActionOption) => void;
  onFlipCard: () => void;
  onBattlefieldClick: (card: CardDto) => void;
  onAttackerClick: (card: CardDto) => void;
  onAssignBlock: (blockerId: string, attackerId: string) => void;
  onUnassignBlock: (blockerId: string) => void;
  onTargetPlayer: (playerId: string) => void;
  onOpenZone: (
    title: string,
    cards: CardDto[],
    onClickCard?: (cardId: string) => void,
    clickableCardIds?: string[],
    targetHostile?: boolean,
  ) => void;
  onOpenZoneAndCast: (
    title: string,
    cards: CardDto[],
    onClickCard: (cardId: string) => void,
    clickableCardIds?: string[],
  ) => void;
  onTargetFromZone: (cardId: string) => void;
  delveAvailable?: boolean;
  onOpenDelveZone?: () => void;
  onCastSpell: (cardId: string) => void;
  onTapLand?: (card: CardDto) => void;
  onTapLands?: (cardIds: string[]) => void;
  onTapLandAbility?: (actionId: string) => void;
  onUntapLand?: (card: CardDto) => void;
  onUntapLands?: (cardIds: string[]) => void;

  pixiExternalBlockers?: ScreenBounds[];

  boardSceneRef?: React.MutableRefObject<BoardScene | null>;

  battlefieldContainerRef?: React.RefObject<HTMLDivElement | null>;

  handSelectionMode?: boolean;
  handSelectedIds?: Set<string>;
  onHandCardToggle?: (cardId: string) => void;
}

export function GameBoard({
  me,
  opponents,
  myPermanents,
  opponentPermanentsByPlayer,
  myHand,
  graveyard,
  exile,
  myCommandZone,
  playableIds,
  activePlayerId,
  priorityPlayerId,
  step,
  promptType,
  currentPrompt,
  boardTargets,
  pendingAttackers,
  pendingAttacker,
  pendingBlocker,
  damageOrder,
  damageOrderBlockerIds,
  selectedAttackDefenderId,
  blockAssignments,
  combatAssignments,
  arrowSpecs,
  castingArrow,
  playerIsTargetable,
  monarchId,
  initiativeHolderId,
  turnFlashPlayerId,
  zonePanelOrder,
  isOverBattlefield,
  draggingCardId,
  draggingIsPermanent,
  castingCardId,
  onHandCardDragStart,
  onHandCardClick,
  onHoverCard,
  onDismissHoverPreview,
  getHandActions,
  onSelectHandAction,
  onFlipCard,
  onBattlefieldClick,
  onAttackerClick,
  onAssignBlock,
  onUnassignBlock,
  onTargetPlayer,
  onOpenZone,
  onOpenZoneAndCast,
  onTargetFromZone,
  delveAvailable,
  onOpenDelveZone,
  onCastSpell,
  onTapLand,
  onTapLands,
  onTapLandAbility,
  onUntapLand,
  onUntapLands,
  pixiExternalBlockers,
  boardSceneRef,
  battlefieldContainerRef,
  handSelectionMode,
  handSelectedIds,
  onHandCardToggle,
}: GameBoardProps) {
  const selfStops = usePhaseStopStore((s) => s.selfStops);
  const toggleSelfStop = usePhaseStopStore((s) => s.toggleSelfStop);

  const vScale = useHandScale();

  const handWidth = useMemo(() => {
    if (myHand.length === 0) return 0;
    const cardW = Math.round(HAND_CARD_BASE.cardW * vScale);
    const layout = computeBaseLayout(
      myHand.length,
      cardW,
      Math.round(HAND_FAN_PARAMS.maxSpread * vScale),
      Math.round(HAND_FAN_PARAMS.minSpread * vScale),
      Math.round(HAND_FAN_PARAMS.spreadWidth * vScale),
    );
    if (layout.length === 0) return 0;
    const xs = layout.map((slot) => slot.x);
    return Math.max(...xs) - Math.min(...xs) + cardW;
  }, [myHand.length, vScale]);

  const selfBottomReserve = Math.round(0.55 * HAND_CARD_BASE.cardH * vScale) + GAP;

  const CLUSTER_GAP_FROM_HAND_PX = 12;
  const CLUSTER_MIN_WIDTH_PX = 120;
  const isTargetingPrompt = promptType === "chooseBoardTargets";
  const chooseActionPrompt = promptOf(currentPrompt, "chooseAction");
  const chooseAttackersPrompt = promptOf(currentPrompt, "chooseAttackers");
  const chooseBlockersPrompt = promptOf(currentPrompt, "chooseBlockers");
  const boardTargetsPrompt = promptOf(currentPrompt, "chooseBoardTargets");
  const payManaCostPrompt = promptOf(currentPrompt, "payManaCost");
  const promptAttackerIds = chooseBlockersPrompt?.input.attackers.map((a) => a.attackerId);
  const [dragBlockerId, setDragBlockerId] = useState<string | null>(null);

  const attackingCardIdSet = useMemo(() => {
    const s = new Set<string>();
    for (const c of myPermanents) if (c.isAttacking) s.add(c.id);
    for (const list of opponentPermanentsByPlayer.values())
      for (const c of list) if (c.isAttacking) s.add(c.id);
    return s;
  }, [myPermanents, opponentPermanentsByPlayer]);
  const combatAssignmentsAll = useMemo(() => {
    const byBlocker = new Map<string, string>();
    for (const a of combatAssignments ?? []) byBlocker.set(a.blockerId, a.attackerId);
    for (const a of blockAssignments) byBlocker.set(a.blockerId, a.attackerId);
    return [...byBlocker]
      .filter(([, attackerId]) => attackingCardIdSet.has(attackerId))
      .map(([blockerId, attackerId]) => ({ blockerId, attackerId }));
  }, [combatAssignments, blockAssignments, attackingCardIdSet]);

  const chooseActionActions = chooseActionPrompt?.input.actions;
  const promptActions = chooseActionActions ?? payManaCostPrompt?.input.actions;
  const manaAbilityOptions = promptActions ? manaAbilityInfos(promptActions) : undefined;
  const chooseActionAbilityCardIds = chooseActionActions
    ?.filter((a) => a.type === "activateAbility")
    .map((a) => a.cardId);
  const hostileTargeting = boardTargetsPrompt?.input.hostile ?? false;
  const targetZoneCardIds = (zone: string): string[] =>
    boardTargets?.zone?.zone === zone ? boardTargets.zone.validCardIds : [];
  const commandTargetIds = targetZoneCardIds("Command");
  const graveyardTargetIds = targetZoneCardIds("Graveyard");
  const exileTargetIds = targetZoneCardIds("Exile");
  const commandPlayableIds = myCommandZone
    ?.filter((card) => playableIds.has(card.id))
    .map((card) => card.id);
  const graveyardPlayableIds = graveyard
    .filter((card) => playableIds.has(card.id))
    .map((card) => card.id);
  const exilePlayableIds = exile.filter((card) => playableIds.has(card.id)).map((card) => card.id);
  const selectableBattlefieldCardIds = useMemo(
    () =>
      promptType === "chooseAttackers"
        ? [
            ...(chooseAttackersPrompt?.input.attackers.map((a) => a.attackerId) ?? []),
            ...(pendingAttackers.length > 0
              ? (chooseAttackersPrompt?.input.attackTargets.map((t) => t.id) ?? [])
              : []),
          ]
        : promptType === "chooseBlockers"
          ? pendingAttacker
            ? (chooseBlockersPrompt?.input.attackers.find(
                (a) =>
                  a.attackerId === pendingAttacker && a.validBlockerIds.length >= a.minBlockers,
              )?.validBlockerIds ?? [])
            : (pendingBlocker ?? dragBlockerId)
              ? (chooseBlockersPrompt?.input.attackers
                  .filter(
                    (a) =>
                      a.validBlockerIds.length >= a.minBlockers &&
                      a.validBlockerIds.includes((pendingBlocker ?? dragBlockerId)!),
                  )
                  .map((a) => a.attackerId) ?? [])
              : chooseBlockersPrompt?.input.availableBlockerIds
          : promptType === "chooseDamageAssignmentOrder"
            ? damageOrderBlockerIds
            : promptType === "chooseBoardTargets"
              ? boardTargets?.battlefieldCardIds
              : promptType === "chooseAction"
                ? chooseActionAbilityCardIds
                : undefined,
    [
      promptType,
      chooseAttackersPrompt,
      pendingAttackers,
      pendingAttacker,
      pendingBlocker,
      dragBlockerId,
      chooseBlockersPrompt,
      damageOrderBlockerIds,
      boardTargets,
      chooseActionAbilityCardIds,
    ],
  );
  const pixiBattlefield = useMemo(
    (): BattlefieldState => ({
      cards: myPermanents,
      pendingCardIds:
        promptType === "chooseAttackers"
          ? pendingAttackers
          : promptType === "chooseBlockers"
            ? [
                ...blockAssignments.map((a) => a.blockerId),
                ...(pendingBlocker ? [pendingBlocker] : []),
              ]
            : undefined,
      attackingCardIds: promptAttackerIds,
      orderedCardIds: damageOrder,
      selectableCardIds: selectableBattlefieldCardIds,
      tappableLandIds: promptActions
        ?.filter((a) => a.type === "activateAbility" && a.isManaAbility)
        .map((a) => a.cardId),
      untappableLandIds: promptActions?.filter((a) => a.type === "undoMana").map((a) => a.cardId),
      manaAbilityOptions,
      hostileTargeting,
    }),
    [
      myPermanents,
      promptType,
      pendingAttackers,
      pendingBlocker,
      blockAssignments,
      promptAttackerIds,
      damageOrder,
      selectableBattlefieldCardIds,
      promptActions,
      manaAbilityOptions,
      hostileTargeting,
    ],
  );

  const pixiHand = useMemo(
    (): import("@/pixi/types").HandState => ({
      cards: myHand,
      playableIds,
      draggingCardId,
      draggingIsPermanent,
      castingCardId,
      selectionMode: handSelectionMode,
      selectedIds: handSelectedIds,
    }),
    [
      myHand,
      playableIds,
      draggingCardId,
      draggingIsPermanent,
      castingCardId,
      handSelectionMode,
      handSelectedIds,
    ],
  );

  const pixiCallbacks = useMemo(
    (): GameCanvasCallbacks => ({
      onClickCard:
        promptType === "chooseAction" ||
        promptType === "chooseAttackers" ||
        promptType === "chooseBlockers" ||
        promptType === "chooseBoardTargets"
          ? onBattlefieldClick
          : undefined,
      onHoverCard: (card, bounds) => {
        if (card && bounds) {
          const rect = new DOMRect(bounds.x, bounds.y, bounds.width, bounds.height);
          onHoverCard(card, undefined, { useAnchor: true, anchorOverride: rect });
        } else {
          onHoverCard(null);
        }
      },
      onStartDrag: (card, screenPos) => {
        onHandCardDragStart(card, {
          clientX: screenPos.x,
          clientY: screenPos.y,
          preventDefault: () => {},
        } as React.MouseEvent);
      },
      onClickCard_Hand: (card) => {
        if (handSelectionMode) onHandCardToggle?.(card.id);
        else onHandCardClick(card);
      },
      onDismissHoverPreview,
      onTapLand,
      onTapLands,
      onTapLandAbility,
      onUntapLand,
      onUntapLands,
      onFlipCard,
      onAttackerClick,
      onAssignBlock,
      onUnassignBlock,
      onBlockDragChange: setDragBlockerId,
      onHoverOpponent: (playerId) => {
        hoveredOpponentRef.current = playerId;
      },
    }),
    [
      promptType,
      onBattlefieldClick,
      onHoverCard,
      onDismissHoverPreview,
      onHandCardDragStart,
      onHandCardClick,
      handSelectionMode,
      onHandCardToggle,
      onTapLand,
      onTapLands,
      onTapLandAbility,
      onUntapLand,
      onUntapLands,
      onFlipCard,
      onAttackerClick,
      onAssignBlock,
      onUnassignBlock,
    ],
  );

  const opponentStopsMap = usePhaseStopStore((s) => s.opponentStops);
  const toggleOpponentStop = usePhaseStopStore((s) => s.toggleOpponentStop);

  const pixiPhaseStrip = useMemo((): import("@/pixi/PhaseStripLayer").PhaseStripState => {
    const oppEnabled = new Map<string, Set<string>>();
    for (const op of opponents) {
      oppEnabled.set(op.id, opponentStopsMap.get(op.id) ?? new Set(["end"]));
    }
    return {
      currentStep: step,
      isActiveTurn: activePlayerId === me.id,
      activePlayerId,
      myPlayerId: me.id,
      selfEnabledPhases: selfStops,
      opponentEnabledPhases: oppEnabled,
      opponents: opponents.map((op, i) => ({ id: op.id, index: i })),
      isInteractive: true,
    };
  }, [step, activePlayerId, me.id, selfStops, opponents, opponentStopsMap]);

  const pixiPhaseStripCallbacks = useMemo(
    (): import("@/pixi/PhaseStripLayer").PhaseStripCallbacks => ({
      onToggleSelfPhase: toggleSelfStop,
      onToggleOpponentPhase: toggleOpponentStop,
    }),
    [toggleSelfStop, toggleOpponentStop],
  );

  const boardRef = useRef<HTMLDivElement>(null);

  const battlefieldAutoSort = usePreferencesStore((s) => s.battlefieldAutoSort);
  const pixiPlayerBar = usePreferencesStore((s) => s.pixiPlayerBar);
  const [unifiedLayout, setUnifiedLayout] = useState<BoardCanvasLayout | null>(null);
  const localSceneRef = useRef<BoardScene | null>(null);
  const sceneRef = boardSceneRef ?? localSceneRef;
  const gameTheme = useTheme().gameTheme;
  const playerColors = gameTheme.playerColors;

  // The opponent whose field auto-expands on their turn, or null (our turn → even
  // split). The scene owns + eases the delimiters, draws the grips, and applies
  // the clip — React just sets this target.
  const focusedOpponentId = useMemo(
    () => (opponents.some((op) => op.id === activePlayerId) ? activePlayerId : null),
    [opponents, activePlayerId],
  );

  // Which opponent's battleground the mouse is over (from the scene's hover
  // detection). Stashed for later use.
  const hoveredOpponentRef = useRef<string | null>(null);

  const gameDecks = useGameStore((s) => s.gameDecks);
  const myAvatar = usePreferencesStore((s) => s.customAvatar);
  const defaultPlaymat = usePreferencesStore((s) => s.defaultPlaymat);
  const defaultPlaymatSettings = usePreferencesStore((s) => s.defaultPlaymatSettings);
  const playerDecks = useServerStore((s) => s.playerDecks);

  const avatarByPlayerId = useMemo(() => {
    const map = new Map<string, string>();
    if (myAvatar) map.set(me.id, myAvatar);
    for (const op of opponents) {
      const entry = playerDecks.find((d) => d.username === op.name);
      if (entry?.avatar) map.set(op.id, entry.avatar);
    }
    return map;
  }, [myAvatar, playerDecks, me.id, opponents]);

  // Thin Pixi player bars (behind the `pixiPlayerBar` toggle): self bottom-left,
  // opponents across the top of their fields. When on, the React panels below
  // are hidden.
  const playerBarSpecs = useMemo<PlayerBarSpec[]>(() => {
    const active = gameTheme.activeAction.active;
    const targetColor = hostileTargeting
      ? gameTheme.arrow.hostileTarget
      : gameTheme.arrow.friendlyTarget;

    const zone = (
      key: string,
      label: string,
      cards: CardDto[],
      onOpen: () => void,
      highlightColor?: string,
    ): PlayerZoneSpec => ({ key, label, count: cards.length, onOpen, highlightColor });

    const selfZones: PlayerZoneSpec[] = [];
    if ((myCommandZone?.length ?? 0) > 0) {
      selfZones.push(
        zone(
          "cmd",
          "CMD",
          myCommandZone!,
          () => onOpenZone("Your Command Zone", myCommandZone!),
          (commandPlayableIds?.length ?? 0) > 0 ? active : undefined,
        ),
      );
    }
    const gyPlayable =
      (promptType === "chooseAction" && graveyard.some((c) => playableIds.has(c.id))) ||
      !!delveAvailable;
    const exPlayable = promptType === "chooseAction" && exile.some((c) => playableIds.has(c.id));
    selfZones.push(
      zone(
        "gy",
        "GY",
        graveyard,
        () => onOpenZone("Your Graveyard", graveyard),
        isTargetingPrompt && graveyardTargetIds.length > 0
          ? targetColor
          : gyPlayable
            ? active
            : undefined,
      ),
      zone(
        "ex",
        "EX",
        exile,
        () => onOpenZone("Your Exile", exile),
        isTargetingPrompt && exileTargetIds.length > 0
          ? targetColor
          : exPlayable
            ? active
            : undefined,
      ),
    );

    return [
      {
        playerId: me.id,
        name: me.name,
        life: me.life,
        color: playerColors.self,
        avatarUrl: avatarByPlayerId.get(me.id),
        isBot: me.isHuman === false,
        zones: selfZones,
        isActiveTurn: activePlayerId === me.id,
        isTargetable: playerIsTargetable(me.id),
      },
      ...opponents.map((op, i) => {
        const oppZones: PlayerZoneSpec[] = [];
        if ((op.commandZone?.length ?? 0) > 0) {
          oppZones.push(
            zone("cmd", "CMD", op.commandZone!, () =>
              onOpenZone(`${op.name}'s Command Zone`, op.commandZone!),
            ),
          );
        }
        oppZones.push(
          zone("gy", "GY", op.graveyard, () => onOpenZone(`${op.name}'s Graveyard`, op.graveyard)),
          zone("ex", "EX", op.exile, () => onOpenZone(`${op.name}'s Exile`, op.exile)),
        );
        return {
          playerId: op.id,
          name: op.name,
          life: op.life,
          color: playerColors[OPPONENT_SEATS[i] ?? "opponent1"],
          avatarUrl: avatarByPlayerId.get(op.id),
          isBot: op.isHuman === false,
          zones: oppZones,
          isActiveTurn: activePlayerId === op.id,
          isTargetable: playerIsTargetable(op.id),
        };
      }),
    ];
  }, [
    me,
    opponents,
    playerColors,
    gameTheme,
    avatarByPlayerId,
    activePlayerId,
    playerIsTargetable,
    myCommandZone,
    commandPlayableIds,
    graveyard,
    exile,
    playableIds,
    promptType,
    delveAvailable,
    isTargetingPrompt,
    hostileTargeting,
    graveyardTargetIds,
    exileTargetIds,
    onOpenZone,
  ]);

  const unifiedRegions = useMemo((): BoardCanvasRegion[] => {
    const oppState = (cards: CardDto[]): BattlefieldState => ({
      cards,
      attackingCardIds: promptType === "chooseBlockers" ? promptAttackerIds : undefined,
      orderedCardIds: damageOrder,
      selectableCardIds: selectableBattlefieldCardIds,
      hostileTargeting,
    });
    const myDeck = gameDecks[me.id];
    // Local/AI/hotseat decks skip setDeckSelection, so the default playmat is
    // resolved here too; multiplayer decks already carry it from the relay.
    const myDeckHasPlaymat = !!myDeck?.playmat || !!myDeck?.playmatSettings?.color;
    return [
      {
        playerId: me.id,
        isLocal: true,
        state: pixiBattlefield,
        playmat: myDeckHasPlaymat ? myDeck?.playmat : defaultPlaymat,
        playmatSettings: myDeckHasPlaymat ? myDeck?.playmatSettings : defaultPlaymatSettings,
      },
      ...opponents.map((op, i) => ({
        playerId: op.id,
        isLocal: false,
        state: oppState(opponentPermanentsByPlayer.get(op.id) ?? []),
        playmat: gameDecks[op.id]?.playmat,
        playmatSettings: gameDecks[op.id]?.playmatSettings,
        color: playerColors[OPPONENT_SEATS[i] ?? "opponent1"],
      })),
    ];
  }, [
    me.id,
    opponents,
    opponentPermanentsByPlayer,
    pixiBattlefield,
    promptType,
    promptAttackerIds,
    damageOrder,
    selectableBattlefieldCardIds,
    hostileTargeting,
    gameDecks,
    defaultPlaymat,
    defaultPlaymatSettings,
    playerColors,
  ]);

  const selfPanelLeftPx = (unifiedLayout?.self?.x ?? 0) + 8;
  const selfHalfWidthPx = (unifiedLayout?.self?.width ?? 0) / 2;
  const clusterMaxWidthPx = Math.max(
    CLUSTER_MIN_WIDTH_PX,
    selfHalfWidthPx - handWidth / 2 - CLUSTER_GAP_FROM_HAND_PX - 8,
  );
  const panelElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const setPanelEl = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) panelElsRef.current.set(key, el);
    else panelElsRef.current.delete(key);
  }, []);
  const lastPanelBlockersRef = useRef<string>("");
  useLayoutEffect(() => {
    const board = boardRef.current;
    const scene = sceneRef.current;
    if (!board || !scene) return;
    const b = board.getBoundingClientRect();
    const toRect = (el: Element): BlockingRect => {
      const r = el.getBoundingClientRect();
      return { x: r.left - b.left, y: r.top - b.top, width: r.width, height: r.height };
    };
    const next: Record<string, BlockingRect[]> = {};
    for (const [key, el] of panelElsRef.current) {
      const id = key === "self" ? me.id : key;
      const sections = el.querySelectorAll<HTMLElement>("[data-panel-section]");
      next[id] = sections.length > 0 ? [...sections].map(toRect) : [toRect(el)];
    }
    const actionEl = document.querySelector<HTMLElement>("[data-action-cluster]");
    if (actionEl) (next[me.id] ??= []).push(toRect(actionEl));
    const json = JSON.stringify(next);
    if (json === lastPanelBlockersRef.current) return;
    lastPanelBlockersRef.current = json;
    scene.setPlayerBlockers(new Map(Object.entries(next)));
  }, [
    sceneRef,
    me.id,
    unifiedLayout,
    opponents,
    myCommandZone?.length,
    graveyard.length,
    exile.length,
    promptType,
  ]);
  const selfPanel = (
    <div
      ref={(el) => setPanelEl("self", el)}
      className="absolute bottom-2 z-30 pointer-events-none origin-bottom-left"
      style={{
        left: selfPanelLeftPx,
        maxWidth: `calc(${clusterMaxWidthPx}px / ${SELF_PANEL_SCALE})`,
        transform: `scale(${SELF_PANEL_SCALE})`,
      }}
    >
      <PlayerPanel
        player={me}
        isOpponent={false}
        seat="self"
        avatarUrl={avatarByPlayerId.get(me.id)}
        verticalAlign="bottom"
        isActiveTurn={activePlayerId === me.id}
        isPriorityPlayer={priorityPlayerId === me.id && activePlayerId !== me.id}
        isTargetable={playerIsTargetable(me.id)}
        onTarget={() => onTargetPlayer(me.id)}
        isFlashing={turnFlashPlayerId === me.id}
        isMonarch={monarchId === me.id}
        hasInitiative={initiativeHolderId === me.id}
        commanders={myCommandZone}
        commandPlayableIds={commandPlayableIds}
        graveyard={graveyard}
        exile={exile}
        onCastCommander={onCastSpell}
        onCommanderDragStart={onHandCardDragStart}
        onHoverCard={(card, e) => onHoverCard(card, e, { useAnchor: true })}
        onOpenCommandZone={() => {
          if ((myCommandZone?.length ?? 0) > 0) {
            if (isTargetingPrompt && commandTargetIds.length > 0) {
              onOpenZone(
                "Your Command Zone",
                myCommandZone!,
                onTargetFromZone,
                commandTargetIds,
                hostileTargeting,
              );
              return;
            }
            if ((commandPlayableIds?.length ?? 0) > 0 && promptType === "chooseAction") {
              onOpenZoneAndCast(
                "Your Command Zone",
                myCommandZone!,
                (_cardId) => {},
                commandPlayableIds,
              );
            } else {
              onOpenZone("Your Command Zone", myCommandZone!);
            }
          }
        }}
        onOpenGraveyard={() => {
          if (delveAvailable && onOpenDelveZone) {
            onOpenDelveZone();
            return;
          }
          if (isTargetingPrompt && graveyardTargetIds.length > 0) {
            onOpenZone(
              "Your Graveyard",
              graveyard,
              onTargetFromZone,
              graveyardTargetIds,
              hostileTargeting,
            );
            return;
          }
          if (graveyardPlayableIds.length > 0 && promptType === "chooseAction") {
            onOpenZoneAndCast("Your Graveyard", graveyard, (_cardId) => {}, graveyardPlayableIds);
          } else {
            onOpenZone("Your Graveyard", graveyard);
          }
        }}
        onOpenExile={() => {
          if (isTargetingPrompt && exileTargetIds.length > 0) {
            onOpenZone("Your Exile", exile, onTargetFromZone, exileTargetIds, hostileTargeting);
            return;
          }
          if (exilePlayableIds.length > 0 && promptType === "chooseAction") {
            onOpenZoneAndCast("Your Exile", exile, (_cardId) => {}, exilePlayableIds);
          } else {
            onOpenZone("Your Exile", exile);
          }
        }}
        hasPlayableInGraveyard={
          (promptType === "chooseAction" && graveyard.some((c) => playableIds.has(c.id))) ||
          !!delveAvailable
        }
        hasPlayableInExile={
          promptType === "chooseAction" && exile.some((c) => playableIds.has(c.id))
        }
        hasTargetInGraveyard={isTargetingPrompt && graveyardTargetIds.length > 0}
        hasTargetInExile={isTargetingPrompt && exileTargetIds.length > 0}
        targetHostile={hostileTargeting}
        zonePanelOrder={zonePanelOrder}
      />
    </div>
  );

  return (
    <div
      ref={boardRef}
      className="game-board-surface relative flex flex-col min-h-0 flex-1 overflow-hidden"
    >
      <ReconnectBanner />
      <div ref={battlefieldContainerRef} className="absolute inset-0 z-10 overflow-hidden">
        <BoardCanvas
          regions={unifiedRegions}
          hand={pixiHand}
          arrowSpecs={arrowSpecs ?? []}
          castingArrow={castingArrow}
          declareBlockers={promptType === "chooseBlockers"}
          combatBlocks={combatAssignmentsAll}
          phaseStrip={pixiPhaseStrip}
          phaseStripCallbacks={pixiPhaseStripCallbacks}
          focusedOpponentId={focusedOpponentId}
          playerBars={playerBarSpecs}
          showPlayerBars={pixiPlayerBar}
          callbacks={pixiCallbacks}
          externalBlockers={pixiExternalBlockers}
          isDropActive={isOverBattlefield}
          autoSort={battlefieldAutoSort}
          selfBottomReserve={selfBottomReserve}
          sceneRef={sceneRef}
          getHandActions={getHandActions}
          onSelectHandAction={(_card, action) => onSelectHandAction?.(action)}
          onLayout={setUnifiedLayout}
        />
      </div>
      {!pixiPlayerBar && selfPanel}
      {isFeatureEnabled("debugBattlegroundRects") &&
        unifiedLayout?.opponents.map(({ playerId, rect }, i) => {
          const seat = OPPONENT_SEATS[i] ?? "opponent1";
          return (
            <div
              key={`bg-rect-${playerId}`}
              className="pointer-events-none absolute z-20"
              style={{
                left: rect.x,
                top: rect.y,
                width: rect.width,
                height: rect.height,
                backgroundColor: withAlpha(playerColors[seat], 0.2),
                outline: `2px solid ${withAlpha(playerColors[seat], 0.55)}`,
              }}
            />
          );
        })}
      {!pixiPlayerBar &&
        unifiedLayout?.opponents.map(({ playerId, rect }, i) => {
          const op = opponents.find((o) => o.id === playerId);
          if (!op) return null;
          const scale = `scale(${UNIFIED_OPPONENT_PANEL_SCALE})`;
          const colW = rect.width / opponents.length;
          const homeX = i * colW;
          const pad = Math.min(colW, rect.height) * PLAYMAT_PADDING;
          const panelStyle: React.CSSProperties = {
            left: homeX + 8 + pad,
            top: rect.y + 8 + pad,
            transform: scale,
            transformOrigin: "top left",
          };
          return (
            <div
              key={playerId}
              ref={(el) => setPanelEl(playerId, el)}
              className="absolute z-30"
              style={panelStyle}
            >
              <PlayerPanel
                player={op}
                isOpponent
                seat={OPPONENT_SEATS[i] ?? "opponent1"}
                avatarUrl={avatarByPlayerId.get(op.id)}
                verticalAlign="top"
                zoneOrientation="horizontal"
                isActiveTurn={activePlayerId === op.id}
                isPriorityPlayer={priorityPlayerId === op.id && activePlayerId !== op.id}
                isTargetable={playerIsTargetable(op.id)}
                isSelectedTarget={selectedAttackDefenderId === op.id}
                onTarget={() => onTargetPlayer(op.id)}
                isFlashing={turnFlashPlayerId === op.id}
                isMonarch={monarchId === op.id}
                hasInitiative={initiativeHolderId === op.id}
                commanders={op.commandZone}
                graveyard={op.graveyard}
                exile={op.exile}
                onOpenCommandZone={
                  (op.commandZone?.length ?? 0) > 0
                    ? () => onOpenZone(`${op.name}'s Command Zone`, op.commandZone!)
                    : undefined
                }
                onOpenGraveyard={() => onOpenZone(`${op.name}'s Graveyard`, op.graveyard)}
                onOpenExile={() => onOpenZone(`${op.name}'s Exile`, op.exile)}
                onHoverCard={(card, e) => onHoverCard(card, e, { useAnchor: true })}
                zonePanelOrder={zonePanelOrder}
              />
            </div>
          );
        })}
      <div className="absolute inset-0 z-40 pointer-events-none">
        <BoardArrowsCanvas sceneRef={sceneRef} />
      </div>
    </div>
  );
}
