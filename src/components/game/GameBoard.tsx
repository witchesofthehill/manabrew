import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { GameCard, Player } from "@/types/manabrew";
import type { Prompt } from "@/protocol";
import type { BoardTargetBuckets } from "@/lib/boardTargets";
import { type ZonePanelItem } from "@/stores/usePreferencesStore";
import { BoardCanvas, type BoardCanvasLayout, type BoardCanvasRegion } from "@/pixi/BoardCanvas";
import { BoardArrowsCanvas } from "@/pixi/BoardArrowsCanvas";
import { SELF_HEIGHT_FRACTION, STRIP_BAND_PX } from "@/pixi/board/boardLayout";
import { isFeatureEnabled } from "@/featureFlags";
import type { BoardScene } from "@/pixi/board/BoardScene";
import type { BlockingRect } from "@/pixi/board/types";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import type { ArrowSpec, BattlefieldState, GameCanvasCallbacks, ScreenBounds } from "@/pixi/types";
import { usePhaseStopStore } from "@/stores/usePhaseStopStore";
import type { PromptType } from "@/protocol";
import { PlayerPanel } from "@/components/game/panels";
import { OPPONENT_SEATS } from "@/components/game/game.types";
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
const ACTION_CLUSTER_RESERVE_PX = 360;
const HAND_MIN_WIDTH_PX = 820;

interface GameBoardProps {
  me: Player;
  opponents: Player[];
  myPermanents: GameCard[];
  opponentPermanentsByPlayer: Map<string, GameCard[]>;
  myHand: GameCard[];
  graveyard: GameCard[];
  exile: GameCard[];
  myCommandZone?: GameCard[];
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

  onHandCardDragStart: (card: GameCard, e: React.MouseEvent) => void;
  onHandCardClick: (card: GameCard, e?: React.MouseEvent) => void;
  onHoverCard: (
    card: GameCard | null,
    e?: React.MouseEvent,
    options?: { useAnchor?: boolean; placement?: "auto" | "top-center"; anchorOverride?: DOMRect },
  ) => void;
  onDismissHoverPreview?: () => void;
  getHandActions?: (card: GameCard) => HandActionOption[];
  onSelectHandAction?: (action: HandActionOption) => void;
  onFlipCard: () => void;
  onBattlefieldClick: (card: GameCard) => void;
  onAttackerClick: (card: GameCard) => void;
  onAssignBlock: (blockerId: string, attackerId: string) => void;
  onUnassignBlock: (blockerId: string) => void;
  onTargetPlayer: (playerId: string) => void;
  onOpenZone: (
    title: string,
    cards: GameCard[],
    onClickCard?: (cardId: string) => void,
    clickableCardIds?: string[],
    targetHostile?: boolean,
  ) => void;
  onOpenZoneAndCast: (
    title: string,
    cards: GameCard[],
    onClickCard: (cardId: string) => void,
    clickableCardIds?: string[],
  ) => void;
  onTargetFromZone: (cardId: string) => void;
  delveAvailable?: boolean;
  onOpenDelveZone?: () => void;
  onCastSpell: (cardId: string) => void;
  onTapLand?: (card: GameCard) => void;
  onTapLands?: (cardIds: string[]) => void;
  onTapLandAbility?: (actionId: string) => void;
  onUntapLand?: (card: GameCard) => void;
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
    ?.filter((card) => card.isPlayable)
    .map((card) => card.id);
  const graveyardPlayableIds = graveyard.filter((card) => card.isPlayable).map((card) => card.id);
  const exilePlayableIds = exile.filter((card) => card.isPlayable).map((card) => card.id);
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
      draggingCardId,
      draggingIsPermanent,
      castingCardId,
      selectionMode: handSelectionMode,
      selectedIds: handSelectedIds,
    }),
    [
      myHand,
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

  const boardArrangementPref = usePreferencesStore((s) => s.boardArrangement);
  const battlefieldAutoSort = usePreferencesStore((s) => s.battlefieldAutoSort);
  const boardArrangement = isFeatureEnabled("wraparoundBoardLayout") ? boardArrangementPref : "row";
  const [unifiedLayout, setUnifiedLayout] = useState<BoardCanvasLayout | null>(null);
  const localSceneRef = useRef<BoardScene | null>(null);
  const sceneRef = boardSceneRef ?? localSceneRef;
  const [unifiedSplit, setUnifiedSplit] = useState(SELF_HEIGHT_FRACTION);

  const onUnifiedGripDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const el = boardRef.current;
    if (!el) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const selfFrac = (rect.height - (ev.clientY - rect.top)) / rect.height;
      setUnifiedSplit(Math.max(0.2, Math.min(0.8, selfFrac)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const [opponentSplits, setOpponentSplits] = useState<number[]>([]);
  const opponentFractions = opponentSplits.length === opponents.length ? opponentSplits : undefined;

  const onOpponentGripDown = useCallback(
    (boundary: number) => (e: React.PointerEvent) => {
      e.preventDefault();
      const el = boardRef.current;
      if (!el) return;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const count = opponents.length;
      const start =
        opponentSplits.length === count
          ? [...opponentSplits]
          : Array.from({ length: count }, () => 1 / count);
      const pairSum = start[boundary]! + start[boundary + 1]!;
      const before = start.slice(0, boundary).reduce((a, b) => a + b, 0);
      const onMove = (ev: PointerEvent) => {
        const rect = el.getBoundingClientRect();
        const x = (ev.clientX - rect.left) / rect.width;
        const left = Math.max(0.1, Math.min(pairSum - 0.1, x - before));
        const next = [...start];
        next[boundary] = left;
        next[boundary + 1] = pairSum - left;
        setOpponentSplits(next);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [opponents.length, opponentSplits],
  );

  const unifiedRegions = useMemo((): BoardCanvasRegion[] => {
    const oppState = (cards: GameCard[]): BattlefieldState => ({
      cards,
      attackingCardIds: promptType === "chooseBlockers" ? promptAttackerIds : undefined,
      orderedCardIds: damageOrder,
      selectableCardIds: selectableBattlefieldCardIds,
      hostileTargeting,
    });
    return [
      { playerId: me.id, isLocal: true, state: pixiBattlefield },
      ...opponents.map((op) => ({
        playerId: op.id,
        isLocal: false,
        state: oppState(opponentPermanentsByPlayer.get(op.id) ?? []),
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
  ]);

  const selfPanelLeftPx = (unifiedLayout?.self?.x ?? 0) + 8;
  const selfHalfWidthPx = (unifiedLayout?.self?.width ?? 0) / 2;
  const clusterMaxWidthPx = Math.max(
    CLUSTER_MIN_WIDTH_PX,
    selfHalfWidthPx - handWidth / 2 - CLUSTER_GAP_FROM_HAND_PX - 8,
  );
  const selfIsSplit = boardArrangement === "perimeter";
  const selfRect = unifiedLayout?.self;
  const selfSplit = useMemo(() => {
    const off = { left: 0, right: 0, grid: false };
    if (boardArrangement !== "perimeter") return off;
    const sx = unifiedLayout?.self?.x ?? 0;
    const sw = unifiedLayout?.self?.width ?? 0;
    if (sw === 0) return off;
    const left = 130;
    const tileStride = (72 + 10) * SELF_PANEL_SCALE;
    const zoneTileCount = 3 + ((myCommandZone?.length ?? 0) > 0 ? 1 : 0);
    const rowWidth = zoneTileCount * tileStride;
    const rightForWidth = (w: number) => Math.max(0, ACTION_CLUSTER_RESERVE_PX + w - sx);
    const handIfRow = sw - left - rightForWidth(rowWidth);
    const grid = handIfRow < HAND_MIN_WIDTH_PX;
    const zonesWidth = grid ? Math.min(zoneTileCount, 2) * tileStride : rowWidth;
    return { left, right: Math.round(rightForWidth(zonesWidth)), grid };
  }, [boardArrangement, myCommandZone?.length, unifiedLayout?.self?.x, unifiedLayout?.self?.width]);
  const handInsets = useMemo(
    () => ({ left: selfSplit.left, right: selfSplit.right }),
    [selfSplit.left, selfSplit.right],
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
    boardArrangement,
    selfSplit.grid,
    promptType,
  ]);
  const splitBoardWidth = selfRect ? 2 * selfRect.x + selfRect.width : 0;
  const splitPanelWidth = Math.max(
    CLUSTER_MIN_WIDTH_PX,
    splitBoardWidth - ACTION_CLUSTER_RESERVE_PX - (selfRect ? selfRect.x + 8 : 0),
  );
  const selfPanel = (
    <div
      ref={(el) => setPanelEl("self", el)}
      className="absolute bottom-2 z-30 pointer-events-none origin-bottom-left"
      style={
        selfIsSplit && selfRect
          ? {
              left: selfRect.x + 8,
              width: splitPanelWidth / SELF_PANEL_SCALE,
              transform: `scale(${SELF_PANEL_SCALE})`,
            }
          : {
              left: selfPanelLeftPx,
              maxWidth: `calc(${clusterMaxWidthPx}px / ${SELF_PANEL_SCALE})`,
              transform: `scale(${SELF_PANEL_SCALE})`,
            }
      }
    >
      <PlayerPanel
        player={me}
        isOpponent={false}
        seat="self"
        verticalAlign="bottom"
        split={selfIsSplit}
        zonesGrid={selfSplit.grid}
        isActiveTurn={activePlayerId === me.id}
        isPriorityPlayer={priorityPlayerId === me.id && activePlayerId !== me.id}
        isTargetable={playerIsTargetable(me.id)}
        onTarget={() => onTargetPlayer(me.id)}
        isFlashing={turnFlashPlayerId === me.id}
        isMonarch={monarchId === me.id}
        hasInitiative={initiativeHolderId === me.id}
        commanders={myCommandZone}
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
          (promptType === "chooseAction" && graveyard.some((c) => c.isPlayable)) || !!delveAvailable
        }
        hasPlayableInExile={promptType === "chooseAction" && exile.some((c) => c.isPlayable)}
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
          arrangement={boardArrangement}
          selfHeightFraction={unifiedSplit}
          opponentFractions={opponentFractions}
          callbacks={pixiCallbacks}
          externalBlockers={pixiExternalBlockers}
          handInsets={handInsets}
          isDropActive={isOverBattlefield}
          autoSort={battlefieldAutoSort}
          selfBottomReserve={selfBottomReserve}
          sceneRef={sceneRef}
          getHandActions={getHandActions}
          onSelectHandAction={(_card, action) => onSelectHandAction?.(action)}
          onLayout={setUnifiedLayout}
        />
      </div>
      {selfPanel}
      {unifiedLayout?.opponents.map(({ playerId, rect, orientation }, i) => {
        const op = opponents.find((o) => o.id === playerId);
        if (!op) return null;
        const scale = `scale(${UNIFIED_OPPONENT_PANEL_SCALE})`;
        const panelStyle: React.CSSProperties =
          orientation === "left"
            ? {
                left: rect.x + 8,
                top: rect.y + rect.height / 2,
                transform: `translateY(-50%) ${scale}`,
                transformOrigin: "left center",
              }
            : orientation === "right"
              ? {
                  left: rect.x + rect.width - 8,
                  top: rect.y + rect.height / 2,
                  transform: `translate(-100%, -50%) ${scale}`,
                  transformOrigin: "right center",
                }
              : {
                  left: rect.x + 8,
                  top: rect.y + 8,
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
              verticalAlign="top"
              zoneOrientation={
                orientation === "left" || orientation === "right" ? "vertical" : "horizontal"
              }
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
      {boardArrangement === "row" &&
        unifiedLayout &&
        unifiedLayout.opponents.slice(1).map(({ playerId, rect }) => (
          <div
            key={`oppgrip-${playerId}`}
            className="absolute z-50 w-3 cursor-col-resize flex items-center justify-center group"
            style={{ left: rect.x - 6, top: 0, height: rect.height }}
            onPointerDown={onOpponentGripDown(
              unifiedLayout.opponents.findIndex((o) => o.playerId === playerId) - 1,
            )}
          >
            <div className="w-[3px] h-16 rounded-full bg-white/25 group-hover:bg-white/50" />
          </div>
        ))}
      {unifiedLayout?.self && (
        <div
          className="absolute z-50 w-10 cursor-row-resize flex items-center justify-center group"
          style={{
            left: unifiedLayout.self.x + 4,
            top: unifiedLayout.dividerY - STRIP_BAND_PX / 2,
            height: STRIP_BAND_PX,
          }}
          onPointerDown={onUnifiedGripDown}
        >
          <div className="flex flex-col items-center gap-[3px]">
            <div className="w-4 h-[2px] rounded-full bg-white/25 group-hover:bg-white/50" />
            <div className="w-6 h-[2px] rounded-full bg-white/35 group-hover:bg-white/60" />
            <div className="w-4 h-[2px] rounded-full bg-white/25 group-hover:bg-white/50" />
          </div>
        </div>
      )}
    </div>
  );
}
