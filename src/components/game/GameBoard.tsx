import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CardDto, PlayerDto } from "@/protocol/game";
import type { Prompt } from "@/protocol";
import type { BoardTargetBuckets } from "@/lib/boardTargets";
import { type ZonePanelItem } from "@/stores/usePreferencesStore";
import { BoardCanvas, type BoardCanvasLayout, type BoardCanvasRegion } from "@/pixi/BoardCanvas";
import { BoardArrowsCanvas } from "@/pixi/BoardArrowsCanvas";
import { isFeatureEnabled } from "@/featureFlags";
import type { BoardScene } from "@/pixi/board/BoardScene";
import type { PlayerHudSpec, PlayerHudBadge } from "@/pixi/hud/playerHud.types";
import { buildPlayerHudBadges } from "@/components/game/panels/playerHudBadges";
import { PlayerSheetModal } from "@/components/game/panels/PlayerSheetModal";
import type { ZoneTileSpec } from "@/pixi/board/BoardZoneTiles";
import type { BlockingRect } from "@/pixi/board/types";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useGameStore } from "@/stores/useGameStore";
import { useServerStore } from "@/stores/useServerStore";
import { useGameDevStore } from "@/stores/useGameDevStore";
import type { ArrowSpec, BattlefieldState, GameCanvasCallbacks, ScreenBounds } from "@/pixi/types";
import { usePhaseStopStore } from "@/stores/usePhaseStopStore";
import type { PromptType } from "@/protocol";
import { OPPONENT_SEATS } from "@/components/game/game.types";
import { useTheme } from "@/hooks/useTheme";
import { withAlpha } from "@/themes/gameTheme";
import { manaAbilityInfos } from "@/components/game/game.utils";
import { useHandScale } from "@/hooks/useHandScale";
import { HAND_CARD_BASE } from "@/components/game/game.styles";
import { GAP } from "@/pixi/constants";
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
  concededPlayerIds?: string[];

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
  onLayoutChange?: (layout: BoardCanvasLayout) => void;
  boardSurfaceRef?: (el: HTMLDivElement | null) => void;
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
  concededPlayerIds,
  turnFlashPlayerId,
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
  onLayoutChange,
  boardSurfaceRef,
}: GameBoardProps) {
  const selfStops = usePhaseStopStore((s) => s.selfStops);
  const toggleSelfStop = usePhaseStopStore((s) => s.toggleSelfStop);

  const vScale = useHandScale();

  const selfBottomReserve = Math.round(0.55 * HAND_CARD_BASE.cardH * vScale) + GAP;

  const isTargetingPrompt = promptType === "chooseBoardTargets";
  const chooseActionPrompt = promptOf(currentPrompt, "chooseAction");
  const chooseAttackersPrompt = promptOf(currentPrompt, "chooseAttackers");
  const chooseBlockersPrompt = promptOf(currentPrompt, "chooseBlockers");
  const boardTargetsPrompt = promptOf(currentPrompt, "chooseBoardTargets");
  const payManaCostPrompt = promptOf(currentPrompt, "payManaCost");
  const promptAttackerIds = chooseBlockersPrompt?.input.attackers.map((a) => a.attackerId);
  const [dragBlockerId, setDragBlockerId] = useState<string | null>(null);
  const [sheetPlayerId, setSheetPlayerId] = useState<string | null>(null);

  // On our turn, one opponent field stays expanded (sticky) instead of an even
  // split: the last-active opponent by default, or whichever we last hovered.
  // Remember the active opponent (adjust-state-during-render) so it stays
  // expanded once the turn returns to us, until we hover a different board.
  const isSelfTurn = !opponents.some((op) => op.id === activePlayerId);
  const [stickyOpponentId, setStickyOpponentId] = useState<string | null>(null);
  const [prevActivePlayerId, setPrevActivePlayerId] = useState(activePlayerId);
  if (activePlayerId !== prevActivePlayerId) {
    setPrevActivePlayerId(activePlayerId);
    if (!isSelfTurn) setStickyOpponentId(activePlayerId);
  }

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
        if (playerId && isSelfTurn) setStickyOpponentId(playerId);
      },
      onTargetPlayer,
      onShowPlayerSheet: setSheetPlayerId,
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
      onTargetPlayer,
      setDragBlockerId,
      setSheetPlayerId,
      setStickyOpponentId,
      isSelfTurn,
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
  const setBoardRef = useCallback(
    (el: HTMLDivElement | null) => {
      boardRef.current = el;
      boardSurfaceRef?.(el);
    },
    [boardSurfaceRef],
  );

  const battlefieldAutoSort = usePreferencesStore((s) => s.battlefieldAutoSort);
  const [unifiedLayout, setUnifiedLayout] = useState<BoardCanvasLayout | null>(null);
  const localSceneRef = useRef<BoardScene | null>(null);
  const sceneRef = boardSceneRef ?? localSceneRef;
  const gameTheme = useTheme().gameTheme;
  const playerColors = gameTheme.playerColors;

  // The opponent whose field auto-expands: the active one on their turn,
  // otherwise the sticky one on ours (defaulting to the first opponent). The
  // scene owns + eases the delimiters, draws the grips, and applies the clip —
  // React just sets this target.
  const focusedOpponentId = useMemo(() => {
    if (!isSelfTurn) return activePlayerId;
    if (stickyOpponentId && opponents.some((op) => op.id === stickyOpponentId)) {
      return stickyOpponentId;
    }
    return opponents[0]?.id ?? null;
  }, [isSelfTurn, activePlayerId, stickyOpponentId, opponents]);

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

  // Pixi player HUD capsules: self bottom-left, opponents across the top of
  // their fields. Carries the life, mana pool, and active player/game badges.
  const devOverrides = useGameDevStore((s) => s.playerOverrides);
  const currentRoom = useServerStore((s) => s.currentRoom);
  const playerBarSpecs = useMemo<PlayerHudSpec[]>(() => {
    const allPlayers = [me, ...opponents];
    const seatColorOf = (pid: string): string => {
      if (pid === me.id) return playerColors.self;
      const idx = opponents.findIndex((o) => o.id === pid);
      return playerColors[OPPONENT_SEATS[idx] ?? "opponent1"];
    };
    const nameOf = (pid: string): string =>
      allPlayers.find((p) => p.id === pid)?.name ?? "a player";
    // Commander damage is keyed by the source commander's card id; resolve each
    // to its owner so the badge can take that opponent's seat colour.
    const cardOwner = new Map<string, string>();
    const addCards = (cards?: CardDto[]) => cards?.forEach((c) => cardOwner.set(c.id, c.ownerId));
    addCards(myPermanents);
    for (const list of opponentPermanentsByPlayer.values()) addCards(list);
    for (const p of allPlayers) {
      addCards(p.commandZone);
      addCards(p.graveyard);
      addCards(p.exile);
    }
    const roomByName = new Map(currentRoom?.players.map((p) => [p.username, p]) ?? []);
    const concededSet = new Set(concededPlayerIds ?? []);

    // Dev overrides are applied to every player (not just self) so the dev
    // panel can light up each state on all opponents at once. In production
    // these are all empty/false, so this is a no-op.
    const dev = devOverrides;
    const cmdDamageBadges = (player: PlayerDto): PlayerHudBadge[] => {
      if (dev.cmdDamage != null) {
        return dev.cmdDamage > 0
          ? [
              {
                id: "cmd-dev",
                icon: "crossed-swords",
                color: gameTheme.badges.commanderDamage,
                label: "Commander Damage Taken",
                count: dev.cmdDamage,
                lethal: dev.cmdDamage >= 21,
              },
            ]
          : [];
      }
      return Object.entries(player.commanderDamage ?? {})
        .filter(([, dmg]) => dmg > 0)
        .map(([cardId, dmg]) => {
          const ownerId = cardOwner.get(cardId);
          return {
            id: `cmd-${cardId}`,
            icon: "crossed-swords",
            color: ownerId ? seatColorOf(ownerId) : gameTheme.badges.commanderDamage,
            label: `Commander Damage from ${ownerId ? nameOf(ownerId) : "a commander"}`,
            count: dmg,
            lethal: dmg >= 21,
          };
        });
    };

    const toSpec = (player: PlayerDto, color: string, isSelf: boolean): PlayerHudSpec => {
      const badges = [
        ...buildPlayerHudBadges(
          {
            isMonarch: dev.forceMonarch ? true : monarchId === player.id,
            hasInitiative: dev.forceInitiative ? true : initiativeHolderId === player.id,
            poison: dev.poison ?? player.poison,
            energy: dev.energy ?? player.energyCounters,
            radiation: dev.radiation ?? player.radiationCounters,
            experience: dev.experience ?? player.experienceCounters,
            ticket: dev.ticket ?? player.ticketCounters,
            cityBlessing: dev.forceCityBlessing ? true : player.hasCityBlessing,
            ringLevel: dev.ringLevel ?? player.ringLevel,
            speed: dev.speed ?? player.speed,
            handCount: dev.handCount ?? player.hand.length,
          },
          gameTheme.badges,
        ),
        ...cmdDamageBadges(player),
      ];
      return {
        playerId: player.id,
        name: player.name,
        isSelf,
        life: dev.life ?? player.life,
        color,
        avatarUrl: avatarByPlayerId.get(player.id),
        isBot: player.isHuman === false,
        isActiveTurn: dev.forceActiveTurn ? true : activePlayerId === player.id,
        isPriorityPlayer: dev.forcePriority
          ? true
          : priorityPlayerId === player.id && activePlayerId !== player.id,
        isTargetable: dev.forceTargetable ? true : playerIsTargetable(player.id),
        isSelectedTarget: dev.forceSelectedTarget ? true : selectedAttackDefenderId === player.id,
        isFlashing: dev.forceFlashing ? true : turnFlashPlayerId === player.id,
        isEliminated: dev.forceEliminated ? true : concededSet.has(player.id),
        isDisconnected: dev.forceDisconnected
          ? true
          : !isSelf && player.isHuman && roomByName.get(player.name)?.connected === false,
        manaPool: player.manaPool,
        badges,
      };
    };
    return [
      toSpec(me, playerColors.self, true),
      ...opponents.map((op, i) =>
        toSpec(op, playerColors[OPPONENT_SEATS[i] ?? "opponent1"], false),
      ),
    ];
  }, [
    me,
    opponents,
    playerColors,
    avatarByPlayerId,
    activePlayerId,
    priorityPlayerId,
    playerIsTargetable,
    selectedAttackDefenderId,
    turnFlashPlayerId,
    monarchId,
    initiativeHolderId,
    gameTheme.badges,
    devOverrides,
    currentRoom,
    concededPlayerIds,
    myPermanents,
    opponentPermanentsByPlayer,
  ]);

  // Shared open-handlers for the local player's command / graveyard / exile
  // zones. Used by BOTH the on-grid Pixi tiles and the React panel so the
  // cast-vs-target-vs-open branching can't drift between them.
  const openCommandZone = useCallback(() => {
    if (!myCommandZone || myCommandZone.length === 0) return;
    if (isTargetingPrompt && commandTargetIds.length > 0) {
      onOpenZone(
        "Your Command Zone",
        myCommandZone,
        onTargetFromZone,
        commandTargetIds,
        hostileTargeting,
      );
      return;
    }
    if ((commandPlayableIds?.length ?? 0) > 0 && promptType === "chooseAction") {
      onOpenZoneAndCast("Your Command Zone", myCommandZone, (_cardId) => {}, commandPlayableIds);
    } else {
      onOpenZone("Your Command Zone", myCommandZone);
    }
  }, [
    myCommandZone,
    isTargetingPrompt,
    commandTargetIds,
    onOpenZone,
    onTargetFromZone,
    hostileTargeting,
    commandPlayableIds,
    promptType,
    onOpenZoneAndCast,
  ]);

  const openGraveyard = useCallback(() => {
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
  }, [
    delveAvailable,
    onOpenDelveZone,
    isTargetingPrompt,
    graveyardTargetIds,
    onOpenZone,
    graveyard,
    onTargetFromZone,
    hostileTargeting,
    graveyardPlayableIds,
    promptType,
    onOpenZoneAndCast,
  ]);

  const openExile = useCallback(() => {
    if (isTargetingPrompt && exileTargetIds.length > 0) {
      onOpenZone("Your Exile", exile, onTargetFromZone, exileTargetIds, hostileTargeting);
      return;
    }
    if (exilePlayableIds.length > 0 && promptType === "chooseAction") {
      onOpenZoneAndCast("Your Exile", exile, (_cardId) => {}, exilePlayableIds);
    } else {
      onOpenZone("Your Exile", exile);
    }
  }, [
    isTargetingPrompt,
    exileTargetIds,
    onOpenZone,
    exile,
    onTargetFromZone,
    hostileTargeting,
    exilePlayableIds,
    promptType,
    onOpenZoneAndCast,
  ]);

  // On-grid zone tiles (deck / graveyard / exile / command) per player — same
  // data + open/highlight behaviour as the panel, rendered on the battlefield.
  const zoneTilesByPlayer = useMemo<Record<string, ZoneTileSpec[]>>(() => {
    const active = gameTheme.activeAction.active;
    const targetColor = hostileTargeting
      ? gameTheme.arrow.hostileTarget
      : gameTheme.arrow.friendlyTarget;
    const top = (cards: CardDto[]) => (cards.length > 0 ? cards[cards.length - 1] : undefined);

    const gyPlayable =
      (promptType === "chooseAction" && graveyard.some((c) => playableIds.has(c.id))) ||
      !!delveAvailable;
    const exPlayable = promptType === "chooseAction" && exile.some((c) => playableIds.has(c.id));

    const self: ZoneTileSpec[] = [
      { key: "lib", label: "Lib", count: me.libraryCount, back: true },
      {
        key: "gy",
        label: "GY",
        count: graveyard.length,
        topCard: top(graveyard),
        onOpen: openGraveyard,
        highlightColor:
          isTargetingPrompt && graveyardTargetIds.length > 0
            ? targetColor
            : gyPlayable
              ? active
              : undefined,
      },
      {
        key: "ex",
        label: "EX",
        count: exile.length,
        topCard: top(exile),
        onOpen: openExile,
        highlightColor:
          isTargetingPrompt && exileTargetIds.length > 0
            ? targetColor
            : exPlayable
              ? active
              : undefined,
      },
    ];
    if ((myCommandZone?.length ?? 0) > 0) {
      self.push({
        key: "cmd",
        label: "CMD",
        count: myCommandZone!.length,
        topCard: top(myCommandZone!),
        onOpen: openCommandZone,
        highlightColor: (commandPlayableIds?.length ?? 0) > 0 ? active : undefined,
      });
    }

    const byPlayer: Record<string, ZoneTileSpec[]> = { [me.id]: self };
    for (const op of opponents) {
      const tiles: ZoneTileSpec[] = [
        { key: "lib", label: "Lib", count: op.libraryCount, back: true },
        {
          key: "gy",
          label: "GY",
          count: op.graveyard.length,
          topCard: top(op.graveyard),
          onOpen: () => onOpenZone(`${op.name}'s Graveyard`, op.graveyard),
        },
        {
          key: "ex",
          label: "EX",
          count: op.exile.length,
          topCard: top(op.exile),
          onOpen: () => onOpenZone(`${op.name}'s Exile`, op.exile),
        },
      ];
      if ((op.commandZone?.length ?? 0) > 0) {
        tiles.push({
          key: "cmd",
          label: "CMD",
          count: op.commandZone.length,
          topCard: top(op.commandZone),
          onOpen: () => onOpenZone(`${op.name}'s Command Zone`, op.commandZone),
        });
      }
      byPlayer[op.id] = tiles;
    }
    return byPlayer;
  }, [
    me.id,
    me.libraryCount,
    opponents,
    gameTheme,
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
    openCommandZone,
    openGraveyard,
    openExile,
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

  // Keep battlefield cards from laying out under the local action-button
  // cluster. (Player panels no longer reserve space — the Pixi HUD sits in the
  // playmat's own margin.)
  const lastPanelBlockersRef = useRef<string>("");
  useLayoutEffect(() => {
    const board = boardRef.current;
    const scene = sceneRef.current;
    if (!board || !scene) return;
    const b = board.getBoundingClientRect();
    const actionEl = document.querySelector<HTMLElement>("[data-action-cluster]");
    const next: Record<string, BlockingRect[]> = {};
    if (actionEl) {
      const r = actionEl.getBoundingClientRect();
      next[me.id] = [{ x: r.left - b.left, y: r.top - b.top, width: r.width, height: r.height }];
    }
    const json = JSON.stringify(next);
    if (json === lastPanelBlockersRef.current) return;
    lastPanelBlockersRef.current = json;
    scene.setPlayerBlockers(new Map(Object.entries(next)));
  }, [sceneRef, me.id, unifiedLayout, promptType]);

  const sheetSpec = sheetPlayerId
    ? (playerBarSpecs.find((s) => s.playerId === sheetPlayerId) ?? null)
    : null;

  // Screen-reader mirror of the Pixi HUD (Pixi has no DOM accessibility).
  const a11ySummary = useMemo(() => {
    const active = playerBarSpecs.find((s) => s.isActiveTurn);
    const players = playerBarSpecs
      .map((s) => {
        const tags = [
          s.isEliminated ? "eliminated" : null,
          s.isDisconnected ? "disconnected" : null,
        ].filter(Boolean);
        const who = s.isSelf ? "You" : s.name;
        return `${who}: ${s.life} life${tags.length ? ` (${tags.join(", ")})` : ""}`;
      })
      .join(". ");
    const turn = active ? `${active.isSelf ? "Your" : `${active.name}'s`} turn. ` : "";
    return `${turn}${players}.`;
  }, [playerBarSpecs]);

  return (
    <div
      ref={setBoardRef}
      className="game-board-surface relative flex flex-col min-h-0 flex-1 overflow-hidden"
    >
      <ReconnectBanner />
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {a11ySummary}
      </div>
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
          showPlayerBars
          zoneTiles={zoneTilesByPlayer}
          callbacks={pixiCallbacks}
          externalBlockers={pixiExternalBlockers}
          isDropActive={isOverBattlefield}
          autoSort={battlefieldAutoSort}
          selfBottomReserve={selfBottomReserve}
          sceneRef={sceneRef}
          getHandActions={getHandActions}
          onSelectHandAction={(_card, action) => onSelectHandAction?.(action)}
          onLayout={(layout) => {
            setUnifiedLayout(layout);
            onLayoutChange?.(layout);
          }}
        />
      </div>
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
      <div className="absolute inset-0 z-40 pointer-events-none">
        <BoardArrowsCanvas sceneRef={sceneRef} />
      </div>
      {sheetSpec && <PlayerSheetModal spec={sheetSpec} onClose={() => setSheetPlayerId(null)} />}
    </div>
  );
}
