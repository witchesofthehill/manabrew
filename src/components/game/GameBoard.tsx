import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useKeybindings } from "@/hooks/useKeybindings";
import type { CardDto, PlayerDto } from "@/protocol/game";
import type { Prompt } from "@/protocol";
import { validCardIdsInCards, type BoardTargetBuckets } from "@/lib/boardTargets";
import { type ZonePanelItem } from "@/stores/usePreferencesStore";
import { BoardCanvas, type BoardCanvasLayout, type BoardCanvasRegion } from "@/pixi/BoardCanvas";
import { BoardOverlayCanvas } from "@/pixi/BoardOverlayCanvas";
import type { StackSpec } from "@/pixi/stack/stack.types";
import type { CombatRow } from "@/components/game/combatRows";
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
import type { ArrowSpec, BattlefieldState, GameCanvasCallbacks } from "@/pixi/types";
import { usePhaseStopStore } from "@/stores/usePhaseStopStore";
import type { PromptType } from "@/protocol";
import { OPPONENT_SEATS } from "@/components/game/game.types";
import { useTheme } from "@/hooks/useTheme";
import { manaAbilityInfos } from "@/components/game/game.utils";
import { useHandScale } from "@/hooks/useHandScale";
import { HAND_CARD_BASE } from "@/components/game/game.styles";
import { ZONE_TILE_KEY } from "@/components/game/game.constants";
import { GAP, HAND_RESERVE_TRIM } from "@/pixi/constants";
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
  attackAssignments: { attackerId: string; targetId: string }[];
  pendingAttacker?: string | null;
  pendingBlocker?: string | null;
  damageOrder?: string[];
  damageOrderBlockerIds?: string[];
  selectedAttackDefenderId?: string | null;
  blockAssignments: { blockerId: string; attackerId: string }[];
  combatAssignments?: { blockerId: string; attackerId: string }[];
  combatRows: CombatRow[];
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
  onAssignAttacker: (attackerId: string, targetId: string) => void;
  onUnassignAttacker: (attackerId: string) => void;
  onTargetPlayer: (playerId: string) => void;
  onShowBoardMenu?: () => void;
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

  stackSpec: StackSpec;
  onOpenStack: () => void;
  onTargetSpell: (spellId: string) => void;
  onHoverStack: (stackObjectId: string | null) => void;
  onToggleStack: () => void;

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
  attackAssignments,
  pendingAttacker,
  pendingBlocker,
  damageOrder,
  damageOrderBlockerIds,
  selectedAttackDefenderId,
  blockAssignments,
  combatAssignments,
  combatRows,
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
  onAssignAttacker,
  onUnassignAttacker,
  onTargetPlayer,
  onShowBoardMenu,
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
  stackSpec,
  onOpenStack,
  onTargetSpell,
  onHoverStack,
  onToggleStack,
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

  const selfBottomReserve = Math.round(
    (0.55 * HAND_CARD_BASE.cardH * vScale + GAP) * HAND_RESERVE_TRIM,
  );

  const isTargetingPrompt = promptType === "chooseBoardTargets";
  const chooseActionPrompt = promptOf(currentPrompt, "chooseAction");
  const chooseAttackersPrompt = promptOf(currentPrompt, "chooseAttackers");
  const chooseBlockersPrompt = promptOf(currentPrompt, "chooseBlockers");
  const boardTargetsPrompt = promptOf(currentPrompt, "chooseBoardTargets");
  const payManaCostPrompt = promptOf(currentPrompt, "payManaCost");
  const promptAttackerIds = chooseBlockersPrompt?.input.attackers.map((a) => a.attackerId);
  const [dragBlockerId, setDragBlockerId] = useState<string | null>(null);
  const [dragAttackerId, setDragAttackerId] = useState<string | null>(null);
  const [sheetPlayerId, setSheetPlayerId] = useState<string | null>(null);

  // On our turn, one opponent field stays expanded (sticky) instead of an even
  // split: the last-active opponent by default, or whichever we last hovered.
  // Remember the active opponent (adjust-state-during-render) so it stays
  // expanded once the turn returns to us, until we hover a different board.
  const isSelfTurn = !opponents.some((op) => op.id === activePlayerId);
  const [stickyOpponentId, setStickyOpponentId] = useState<string | null>(null);
  const [manualFocusId, setManualFocusId] = useState<string | null>(null);
  const [prevActivePlayerId, setPrevActivePlayerId] = useState(activePlayerId);
  if (activePlayerId !== prevActivePlayerId) {
    setPrevActivePlayerId(activePlayerId);
    if (!isSelfTurn) setStickyOpponentId(activePlayerId);
    setManualFocusId(null);
  }

  const attackingCardIdSet = useMemo(() => {
    const s = new Set<string>();
    for (const c of myPermanents) if (c.isAttacking) s.add(c.id);
    for (const list of opponentPermanentsByPlayer.values())
      for (const c of list) if (c.isAttacking) s.add(c.id);
    return s;
  }, [myPermanents, opponentPermanentsByPlayer]);
  const battlefield = useMemo(
    () => [
      ...myPermanents,
      ...opponents.flatMap((op) => opponentPermanentsByPlayer.get(op.id) ?? []),
    ],
    [myPermanents, opponents, opponentPermanentsByPlayer],
  );
  const oppCombatAttackerIds = useMemo(
    () => new Set(combatRows.flatMap((r) => r.attackerIds)),
    [combatRows],
  );
  const combatAssignmentsAll = useMemo(() => {
    const byBlocker = new Map<string, string>();
    for (const a of combatAssignments ?? []) byBlocker.set(a.blockerId, a.attackerId);
    for (const a of blockAssignments) byBlocker.set(a.blockerId, a.attackerId);
    return [...byBlocker]
      .filter(
        ([, attackerId]) =>
          attackingCardIdSet.has(attackerId) && !oppCombatAttackerIds.has(attackerId),
      )
      .map(([blockerId, attackerId]) => ({ blockerId, attackerId }));
  }, [combatAssignments, blockAssignments, attackingCardIdSet, oppCombatAttackerIds]);

  const chooseActionActions = chooseActionPrompt?.input.actions;
  const promptActions = chooseActionActions ?? payManaCostPrompt?.input.actions;
  const manaAbilityOptions = promptActions ? manaAbilityInfos(promptActions) : undefined;
  const chooseActionAbilityCardIds = chooseActionActions
    ?.filter((a) => a.type === "activateAbility")
    .map((a) => a.cardId);
  const hostileTargeting = boardTargetsPrompt?.input.hostile ?? false;
  const targetZoneCardIds = (zone: string, cards?: CardDto[]): string[] =>
    boardTargets?.zone?.zone === zone
      ? validCardIdsInCards(boardTargets.zone.validCardIds, cards)
      : [];
  const commandTargetIds = targetZoneCardIds("Command", myCommandZone);
  const graveyardTargetIds = targetZoneCardIds("Graveyard", graveyard);
  const exileTargetIds = targetZoneCardIds("Exile", exile);
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
              ? (chooseAttackersPrompt?.input.attackTargets
                  .filter((t) => playerIsTargetable(t.id))
                  .map((t) => t.id) ?? [])
              : []),
            ...(dragAttackerId
              ? (() => {
                  const valid =
                    chooseAttackersPrompt?.input.attackers.find(
                      (a) => a.attackerId === dragAttackerId,
                    )?.validTargetIds ?? [];
                  return (
                    chooseAttackersPrompt?.input.attackTargets
                      .filter(
                        (t) =>
                          (t.kind === "planeswalker" || t.kind === "battle") &&
                          valid.includes(t.id),
                      )
                      .map((t) => t.id) ?? []
                  );
                })()
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
      playerIsTargetable,
      pendingAttacker,
      pendingBlocker,
      dragBlockerId,
      dragAttackerId,
      chooseBlockersPrompt,
      damageOrderBlockerIds,
      boardTargets,
      chooseActionAbilityCardIds,
    ],
  );
  const hostileAttackTargetIds = useMemo(
    () =>
      new Set(
        promptType === "chooseAttackers"
          ? (chooseAttackersPrompt?.input.attackTargets
              .filter((t) => t.kind === "planeswalker" || t.kind === "battle")
              .map((t) => t.id) ?? [])
          : [],
      ),
    [promptType, chooseAttackersPrompt],
  );
  const pixiBattlefield = useMemo(
    (): BattlefieldState => ({
      cards: myPermanents,
      pendingCardIds:
        promptType === "chooseAttackers"
          ? [...pendingAttackers, ...attackAssignments.map((a) => a.attackerId)]
          : promptType === "chooseBlockers"
            ? [
                ...blockAssignments.map((a) => a.blockerId),
                ...(pendingBlocker ? [pendingBlocker] : []),
              ]
            : undefined,
      attackingCardIds: promptAttackerIds,
      orderedCardIds: damageOrder,
      selectableCardIds: selectableBattlefieldCardIds,
      mustAttackCardIds:
        promptType === "chooseAttackers"
          ? chooseAttackersPrompt?.input.attackers
              .filter((a) => a.mustAttack)
              .map((a) => a.attackerId)
          : undefined,
      tappableLandIds: promptActions
        ?.filter((a) => a.type === "activateAbility" && a.isManaAbility)
        .map((a) => a.cardId),
      untappableLandIds: promptActions?.filter((a) => a.type === "undoMana").map((a) => a.cardId),
      manaAbilityOptions,
      hostileTargeting,
      hostileTargetCardIds:
        promptType === "chooseAttackers"
          ? (selectableBattlefieldCardIds ?? []).filter((id) => hostileAttackTargetIds.has(id))
          : undefined,
    }),
    [
      myPermanents,
      promptType,
      pendingAttackers,
      attackAssignments,
      pendingBlocker,
      blockAssignments,
      promptAttackerIds,
      damageOrder,
      selectableBattlefieldCardIds,
      chooseAttackersPrompt,
      promptActions,
      manaAbilityOptions,
      hostileTargeting,
      hostileAttackTargetIds,
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
      onAssignAttacker,
      onUnassignAttacker,
      onAttackDragChange: setDragAttackerId,
      onHoverOpponent: (playerId) => {
        hoveredOpponentRef.current = playerId;
        if (playerId && isSelfTurn) setStickyOpponentId(playerId);
      },
      onTargetPlayer,
      onShowPlayerSheet: setSheetPlayerId,
      onShowBoardMenu,
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
      onAssignAttacker,
      onUnassignAttacker,
      onTargetPlayer,
      onShowBoardMenu,
      setDragBlockerId,
      setDragAttackerId,
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

  // Opponent fields to expand during combat: the OTHER party in the combat —
  // the opponents I'm attacking (even-split among them when more than one), or,
  // when I'm being attacked, the field of whoever is attacking me.
  const combatFocusIds = useMemo(() => {
    const myDefenders = new Set<string>();
    const attackingMe = new Set<string>();
    for (const row of combatRows) {
      if (row.defenderId === me.id) {
        for (const g of row.groups) attackingMe.add(g.controllerId);
      } else if (row.groups.some((g) => g.controllerId === me.id)) {
        myDefenders.add(row.defenderId);
      }
    }
    return myDefenders.size > 0 ? [...myDefenders] : [...attackingMe];
  }, [combatRows, me.id]);

  const cycleField = (dir: 1 | -1) => {
    if (opponents.length === 0 || document.querySelector('[role="dialog"]')) return;
    const ids = opponents.map((o) => o.id);
    setManualFocusId((cur) => {
      const i = cur ? ids.indexOf(cur) : -1;
      if (i < 0) return dir === 1 ? ids[0]! : ids[ids.length - 1]!;
      const next = i + dir;
      return next < 0 || next >= ids.length ? null : ids[next]!;
    });
  };
  useKeybindings({
    "focus-next-field": () => cycleField(1),
    "focus-prev-field": () => cycleField(-1),
  });

  // Which opponent's battleground the mouse is over (from the scene's hover
  // detection). Stashed for later use.
  const hoveredOpponentRef = useRef<string | null>(null);

  const gameDecks = useGameStore((s) => s.gameDecks);
  const hiddenPlaymats = useGameStore((s) => s.hiddenPlaymats);
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

  const combatEngagedIds = useMemo(() => {
    const controllerById = new Map(battlefield.map((c) => [c.id, c.controllerId]));
    const playerSet = new Set([me.id, ...opponents.map((o) => o.id)]);
    const engaged = new Set<string>();
    for (const c of battlefield) {
      if (!c.isAttacking || !c.attackingPlayerId) continue;
      engaged.add(c.controllerId);
      const def = playerSet.has(c.attackingPlayerId)
        ? c.attackingPlayerId
        : controllerById.get(c.attackingPlayerId);
      if (def) engaged.add(def);
    }
    for (const a of combatAssignments ?? []) {
      const ctrl = controllerById.get(a.blockerId);
      if (ctrl) engaged.add(ctrl);
    }
    return engaged;
  }, [battlefield, combatAssignments, me.id, opponents]);

  const ownerRingByCard = useMemo(() => {
    const seatColorOf = (pid: string): string =>
      pid === me.id
        ? playerColors.self
        : playerColors[OPPONENT_SEATS[opponents.findIndex((o) => o.id === pid)] ?? "opponent1"];
    const map: Record<string, string> = {};
    for (const c of battlefield) {
      if (c.controllerId !== c.ownerId) map[c.id] = seatColorOf(c.ownerId);
    }
    return map;
  }, [battlefield, playerColors, opponents, me.id]);

  const incomingDamageByPlayer = useMemo(() => {
    const blocked = new Set((combatAssignments ?? []).map((a) => a.attackerId));
    const map = new Map<string, number>();
    for (const c of battlefield) {
      if (!c.isAttacking || !c.attackingPlayerId || blocked.has(c.id)) continue;
      if (c.attackTargetId && c.attackTargetId !== c.attackingPlayerId) continue;
      const p = Number.parseInt(c.power ?? "", 10);
      if (!Number.isFinite(p) || p <= 0) continue;
      map.set(c.attackingPlayerId, (map.get(c.attackingPlayerId) ?? 0) + p);
    }
    return map;
  }, [battlefield, combatAssignments]);

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

    const incomingDamageBadges = (player: PlayerDto): PlayerHudBadge[] => {
      const incoming = incomingDamageByPlayer.get(player.id) ?? 0;
      if (incoming <= 0) return [];
      const lethal = incoming >= (dev.life ?? player.life);
      return [
        {
          id: "incoming-damage",
          icon: "bleeding-wound",
          color: gameTheme.pt.lethal,
          label: lethal ? "Lethal combat damage incoming" : "Combat damage incoming",
          count: incoming,
          lethal,
        },
      ];
    };

    const toSpec = (player: PlayerDto, color: string, isSelf: boolean): PlayerHudSpec => {
      const badges = [
        ...incomingDamageBadges(player),
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
      const incoming = incomingDamageByPlayer.get(player.id) ?? 0;
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
        inCombat: combatEngagedIds.has(player.id),
        combatLethal: incoming > 0 && incoming >= (dev.life ?? player.life),
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
    combatEngagedIds,
    incomingDamageByPlayer,
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
    gameTheme.pt,
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
      { key: ZONE_TILE_KEY.library, label: "Lib", count: me.libraryCount, back: true },
      {
        key: ZONE_TILE_KEY.graveyard,
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
        key: ZONE_TILE_KEY.exile,
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
        key: ZONE_TILE_KEY.command,
        label: "CMD",
        count: myCommandZone!.length,
        topCard: top(myCommandZone!),
        onOpen: openCommandZone,
        highlightColor: (commandPlayableIds?.length ?? 0) > 0 ? active : undefined,
        commander: playerColors.self,
      });
    }

    const byPlayer: Record<string, ZoneTileSpec[]> = { [me.id]: self };
    const opZoneTargetIds = (zone: string, cards: CardDto[]): string[] =>
      isTargetingPrompt && boardTargets?.zone?.zone === zone
        ? validCardIdsInCards(boardTargets.zone.validCardIds, cards)
        : [];
    for (const [oppIndex, op] of opponents.entries()) {
      const gyTargets = opZoneTargetIds("Graveyard", op.graveyard);
      const exTargets = opZoneTargetIds("Exile", op.exile);
      const cmdTargets = opZoneTargetIds("Command", op.commandZone);
      const openOpZone = (title: string, cards: CardDto[], targetIds: string[]) =>
        targetIds.length > 0
          ? onOpenZone(title, cards, onTargetFromZone, targetIds, hostileTargeting)
          : onOpenZone(title, cards);
      const tiles: ZoneTileSpec[] = [
        { key: ZONE_TILE_KEY.library, label: "Lib", count: op.libraryCount, back: true },
        {
          key: ZONE_TILE_KEY.graveyard,
          label: "GY",
          count: op.graveyard.length,
          topCard: top(op.graveyard),
          onOpen: () => openOpZone(`${op.name}'s Graveyard`, op.graveyard, gyTargets),
          highlightColor: gyTargets.length > 0 ? targetColor : undefined,
        },
        {
          key: ZONE_TILE_KEY.exile,
          label: "EX",
          count: op.exile.length,
          topCard: top(op.exile),
          onOpen: () => openOpZone(`${op.name}'s Exile`, op.exile, exTargets),
          highlightColor: exTargets.length > 0 ? targetColor : undefined,
        },
      ];
      if ((op.commandZone?.length ?? 0) > 0) {
        tiles.push({
          key: ZONE_TILE_KEY.command,
          label: "CMD",
          count: op.commandZone.length,
          topCard: top(op.commandZone),
          onOpen: () => openOpZone(`${op.name}'s Command Zone`, op.commandZone, cmdTargets),
          highlightColor: cmdTargets.length > 0 ? targetColor : undefined,
          commander: playerColors[OPPONENT_SEATS[oppIndex] ?? "opponent1"],
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
    playerColors,
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
    boardTargets,
    onTargetFromZone,
    onOpenZone,
    openCommandZone,
    openGraveyard,
    openExile,
  ]);

  const unifiedRegions = useMemo((): BoardCanvasRegion[] => {
    const seatColorOf = (pid: string): string =>
      pid === me.id
        ? playerColors.self
        : playerColors[OPPONENT_SEATS[opponents.findIndex((o) => o.id === pid)] ?? "opponent1"];
    const nameOf = (pid: string): string =>
      pid === me.id ? "You" : (opponents.find((o) => o.id === pid)?.name ?? "Player");
    const rowFields = (combatRow?: CombatRow): Partial<BattlefieldState> => ({
      combatRowAttackerIds: combatRow?.attackerIds,
      combatRowBlocks: combatRow?.blocks,
      combatRowGroups: combatRow?.groups.map((g) => ({
        color: seatColorOf(g.controllerId),
        label: nameOf(g.controllerId),
        avatarUrl: avatarByPlayerId.get(g.controllerId),
        attackerIds: g.attackerIds,
      })),
    });
    const oppState = (cards: CardDto[], combatRow?: CombatRow): BattlefieldState => ({
      cards,
      attackingCardIds: promptType === "chooseBlockers" ? promptAttackerIds : undefined,
      orderedCardIds: damageOrder,
      selectableCardIds: selectableBattlefieldCardIds,
      hostileTargeting,
      ...rowFields(combatRow),
    });

    const selfCards = [...pixiBattlefield.cards];
    const cardsByController = new Map<string, CardDto[]>();
    cardsByController.set(me.id, selfCards);
    for (const op of opponents)
      cardsByController.set(op.id, [...(opponentPermanentsByPlayer.get(op.id) ?? [])]);
    const combatRowByDefender = new Map<string, CombatRow>();
    const cardById = new Map(battlefield.map((c) => [c.id, c]));
    const attachedTo = new Map<string, CardDto[]>();
    for (const c of battlefield) {
      if (!c.attachedTo) continue;
      (attachedTo.get(c.attachedTo) ?? attachedTo.set(c.attachedTo, []).get(c.attachedTo)!).push(c);
    }
    const moveToDefender = (id: string, defList: CardDto[]) => {
      const card = cardById.get(id);
      if (!card) return;
      const ctrl = cardsByController.get(card.controllerId);
      const idx = ctrl?.findIndex((c) => c.id === id) ?? -1;
      if (ctrl && idx >= 0) ctrl.splice(idx, 1);
      defList.push(card);
      for (const child of attachedTo.get(id) ?? []) moveToDefender(child.id, defList);
    };
    for (const row of combatRows) {
      const defList = cardsByController.get(row.defenderId);
      if (!defList) continue;
      for (const attackerId of row.attackerIds) moveToDefender(attackerId, defList);
      combatRowByDefender.set(row.defenderId, row);
    }

    const myDeck = gameDecks[me.id];
    // Local/AI/hotseat decks skip setDeckSelection, so the default playmat is
    // resolved here too; multiplayer decks already carry it from the relay.
    const myDeckHasPlaymat = !!myDeck?.playmat || !!myDeck?.playmatSettings?.color;
    return [
      {
        playerId: me.id,
        isLocal: true,
        state: {
          ...pixiBattlefield,
          cards: selfCards,
          ...rowFields(combatRowByDefender.get(me.id)),
          ownerRingByCard,
        },
        playmat: hiddenPlaymats.has(me.id)
          ? undefined
          : myDeckHasPlaymat
            ? myDeck?.playmat
            : defaultPlaymat,
        playmatSettings: hiddenPlaymats.has(me.id)
          ? undefined
          : myDeckHasPlaymat
            ? myDeck?.playmatSettings
            : defaultPlaymatSettings,
      },
      ...opponents.map((op, i) => ({
        playerId: op.id,
        isLocal: false,
        state: {
          ...oppState(cardsByController.get(op.id) ?? [], combatRowByDefender.get(op.id)),
          ownerRingByCard,
        },
        playmat: hiddenPlaymats.has(op.id) ? undefined : gameDecks[op.id]?.playmat,
        playmatSettings: hiddenPlaymats.has(op.id) ? undefined : gameDecks[op.id]?.playmatSettings,
        color: playerColors[OPPONENT_SEATS[i] ?? "opponent1"],
      })),
    ];
  }, [
    me.id,
    opponents,
    opponentPermanentsByPlayer,
    battlefield,
    combatRows,
    avatarByPlayerId,
    ownerRingByCard,
    pixiBattlefield,
    promptType,
    promptAttackerIds,
    damageOrder,
    selectableBattlefieldCardIds,
    hostileTargeting,
    gameDecks,
    hiddenPlaymats,
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
      const height = Math.min(r.height, unifiedLayout?.selfClusterMaxHeight ?? r.height);
      next[me.id] = [{ x: r.left - b.left, y: r.bottom - b.top - height, width: r.width, height }];
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

  const combatA11y = useMemo(() => {
    const nameOf = (id: string) =>
      id === me.id ? "You" : (opponents.find((o) => o.id === id)?.name ?? "a player");
    const pairs = new Map<string, { attacker: string; defender: string; count: number }>();
    for (const c of battlefield) {
      if (!c.isAttacking || !c.attackingPlayerId) continue;
      const key = `${c.controllerId}->${c.attackingPlayerId}`;
      const e = pairs.get(key);
      if (e) e.count += 1;
      else
        pairs.set(key, {
          attacker: nameOf(c.controllerId),
          defender: nameOf(c.attackingPlayerId),
          count: 1,
        });
    }
    if (pairs.size === 0) return "";
    return `${[...pairs.values()]
      .map(
        (p) =>
          `${p.attacker} ${p.attacker === "You" ? "attack" : "attacks"} ${p.defender} with ${p.count} ${p.count === 1 ? "attacker" : "attackers"}`,
      )
      .join(". ")}.`;
  }, [battlefield, opponents, me.id]);

  return (
    <div
      ref={setBoardRef}
      className="game-board-surface relative flex flex-col min-h-0 flex-1 overflow-hidden"
    >
      <ReconnectBanner />
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {a11ySummary}
      </div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {combatA11y}
      </div>
      <div ref={battlefieldContainerRef} className="absolute inset-0 z-10 overflow-hidden">
        <BoardCanvas
          regions={unifiedRegions}
          hand={pixiHand}
          arrowSpecs={arrowSpecs ?? []}
          castingArrow={castingArrow}
          declareBlockers={promptType === "chooseBlockers"}
          combatBlocks={combatAssignmentsAll}
          declareAttackers={promptType === "chooseAttackers"}
          attackTargets={chooseAttackersPrompt?.input.attackTargets ?? []}
          attackerOptions={chooseAttackersPrompt?.input.attackers ?? []}
          phaseStrip={pixiPhaseStrip}
          phaseStripCallbacks={pixiPhaseStripCallbacks}
          focusedOpponentId={focusedOpponentId}
          combatFocusIds={combatFocusIds}
          manualFocusId={manualFocusId}
          playerBars={playerBarSpecs}
          showPlayerBars
          zoneTiles={zoneTilesByPlayer}
          callbacks={pixiCallbacks}
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
      <div className="absolute inset-0 z-40 pointer-events-none">
        <BoardOverlayCanvas
          sceneRef={sceneRef}
          stackSpec={stackSpec}
          onOpenStack={onOpenStack}
          onTargetSpell={onTargetSpell}
          onHoverStack={onHoverStack}
          onToggleStack={onToggleStack}
        />
      </div>
      {sheetSpec && <PlayerSheetModal spec={sheetSpec} onClose={() => setSheetPlayerId(null)} />}
    </div>
  );
}
