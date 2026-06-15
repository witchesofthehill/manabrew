import { useCallback, useMemo, useRef, useState } from "react";
import type { GameCard, Player } from "@/types/manabrew";
import type { Prompt } from "@/protocol";
import { type ZonePanelItem } from "@/stores/usePreferencesStore";
import { BoardCanvas, type BoardCanvasLayout, type BoardCanvasRegion } from "@/pixi/BoardCanvas";
import { BoardArrowsCanvas } from "@/pixi/BoardArrowsCanvas";
import { SELF_HEIGHT_FRACTION } from "@/pixi/board/boardLayout";
import type { BoardScene } from "@/pixi/board/BoardScene";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import type { ArrowSpec, BattlefieldState, GameCanvasCallbacks, ScreenBounds } from "@/pixi/types";
import { usePhaseStopStore } from "@/stores/usePhaseStopStore";
import type { PromptType } from "@/protocol";
import { PlayerPanel } from "@/components/game/panels";
import { OPPONENT_SEATS } from "@/components/game/game.types";
import { useHandScale } from "@/hooks/useHandScale";
import { HAND_CARD_BASE } from "@/components/game/game.styles";
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
  // Core game state
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

  // Prompt state
  promptType?: PromptType;
  currentPrompt: Prompt | null;

  // Combat state
  pendingAttackers: string[];
  selectedAttackDefenderId?: string | null;
  blockAssignments: { blockerId: string; attackerId: string }[];
  /** Locked-in blocker→attacker assignments from the engine; combined with
   *  pending blockAssignments to drive unified-board combat staging. */
  combatAssignments?: { blockerId: string; attackerId: string }[];
  /** Arrow specs for the unified board (attack/attach/placement). */
  arrowSpecs?: ArrowSpec[];
  playerIsTargetable: (playerId: string) => boolean;

  // Per-player game-wide flags
  monarchId?: string | null;
  initiativeHolderId?: string | null;

  // Flash state
  turnFlashPlayerId: string | null;

  // Preferences
  zonePanelOrder: ZonePanelItem[];

  // Battlefield drag state
  isOverBattlefield: boolean;
  draggingCardId?: string;
  castingCardId?: string | null;

  // Callbacks
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
  onTargetPlayer: (playerId: string) => void;
  onOpenZone: (
    title: string,
    cards: GameCard[],
    onClickCard?: (cardId: string) => void,
    clickableCardIds?: string[],
  ) => void;
  onOpenZoneAndCast: (
    title: string,
    cards: GameCard[],
    onClickCard: (cardId: string) => void,
    clickableCardIds?: string[],
  ) => void;
  onReopenZoneTarget: () => void;
  onTargetFromZone: (cardId: string) => void;
  onCastSpell: (cardId: string) => void;
  onTapLand?: (card: GameCard) => void;
  onTapLands?: (cardIds: string[]) => void;
  onTapLandAbility?: (cardId: string, abilityIndex: number, color?: string) => void;
  onUntapLand?: (card: GameCard) => void;
  onUntapLands?: (cardIds: string[]) => void;

  /** Canvas-local keep-out rects (e.g. the StackDisplay panel when it is
   *  mounted) so battlefield cards beneath them move into a free cell. */
  pixiExternalBlockers?: ScreenBounds[];

  /** Out-ref populated with the live unified BoardScene so Game.tsx can read
   *  its canvas for the stack-panel keep-out translation. */
  boardSceneRef?: React.MutableRefObject<BoardScene | null>;

  /** Mulligan-bottom selection overlay applied to the in-game hand so
   *  the player picks cards to send to the bottom of the library
   *  directly from the real hand fan instead of a separate modal. */
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
  pendingAttackers,
  selectedAttackDefenderId,
  blockAssignments,
  combatAssignments,
  arrowSpecs,
  playerIsTargetable,
  monarchId,
  initiativeHolderId,
  turnFlashPlayerId,
  zonePanelOrder,
  isOverBattlefield,
  draggingCardId,
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
  onTargetPlayer,
  onOpenZone,
  onOpenZoneAndCast,
  onReopenZoneTarget,
  onTargetFromZone,
  onCastSpell,
  onTapLand,
  onTapLands,
  onTapLandAbility,
  onUntapLand,
  onUntapLands,
  pixiExternalBlockers,
  boardSceneRef,
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

  const CLUSTER_GAP_FROM_HAND_PX = 12;
  const CLUSTER_MIN_WIDTH_PX = 120;
  const isTargetingPrompt = promptType === "chooseTargetCard" || promptType === "chooseTargetAny";
  const chooseActionPrompt = promptOf(currentPrompt, "chooseAction");
  const chooseAttackersPrompt = promptOf(currentPrompt, "chooseAttackers");
  const chooseBlockersPrompt = promptOf(currentPrompt, "chooseBlockers");
  const chooseTargetCardPrompt = promptOf(currentPrompt, "chooseTargetCard");
  const chooseTargetAnyPrompt = promptOf(currentPrompt, "chooseTargetAny");
  const chooseTargetCardFromZonePrompt = promptOf(currentPrompt, "chooseTargetCardFromZone");
  const payCombatCostPrompt = promptOf(currentPrompt, "payCombatCost");
  const payManaCostPrompt = promptOf(currentPrompt, "payManaCost");
  const promptAttackerIds = chooseBlockersPrompt?.input.attackerIds;
  const manaAbilityOptions =
    chooseActionPrompt?.input.manaAbilityOptions ?? payManaCostPrompt?.input.manaAbilityOptions;
  const hostileTargeting =
    chooseTargetCardPrompt?.input.hostile ?? chooseTargetAnyPrompt?.input.hostile ?? false;
  const targetCardIds = new Set(
    promptType === "chooseTargetCard"
      ? (chooseTargetCardPrompt?.input.validCardIds ?? [])
      : promptType === "chooseTargetAny"
        ? (chooseTargetAnyPrompt?.input.validCardIds ?? [])
        : [],
  );
  const targetZoneCardIds = (zone: string): string[] => {
    if (promptType === "chooseTargetCard" || promptType === "chooseTargetAny") {
      return [...targetCardIds];
    }
    if (
      promptType === "chooseTargetCardFromZone" &&
      chooseTargetCardFromZonePrompt?.input.zone === zone
    ) {
      return chooseTargetCardFromZonePrompt.input.validCardIds;
    }
    return [];
  };
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
            ...(chooseAttackersPrompt?.input.availableAttackerIds ?? []),
            ...(pendingAttackers.length > 0
              ? (chooseAttackersPrompt?.input.possibleDefenderIds.map((defender) => defender.id) ??
                [])
              : []),
          ]
        : promptType === "chooseBlockers"
          ? chooseBlockersPrompt?.input.availableBlockerIds
          : promptType === "chooseTargetCard"
            ? chooseTargetCardPrompt?.input.validCardIds
            : promptType === "chooseTargetAny"
              ? chooseTargetAnyPrompt?.input.validCardIds
              : promptType === "chooseTargetCardFromZone" &&
                  chooseTargetCardFromZonePrompt?.input.zone === "Battlefield"
                ? chooseTargetCardFromZonePrompt.input.validCardIds
                : undefined,
    [
      promptType,
      chooseAttackersPrompt,
      pendingAttackers,
      chooseBlockersPrompt,
      chooseTargetCardPrompt,
      chooseTargetAnyPrompt,
      chooseTargetCardFromZonePrompt,
    ],
  );
  const pixiBattlefield = useMemo(
    (): BattlefieldState => ({
      cards: myPermanents,
      pendingCardIds:
        promptType === "chooseAttackers"
          ? pendingAttackers
          : promptType === "chooseBlockers"
            ? blockAssignments.map((a) => a.blockerId)
            : undefined,
      attackingCardIds: promptAttackerIds,
      selectableCardIds: selectableBattlefieldCardIds,
      tappableLandIds:
        chooseActionPrompt || payCombatCostPrompt || payManaCostPrompt
          ? (chooseActionPrompt?.input.tappableLandIds ??
            payCombatCostPrompt?.input.tappableLandIds ??
            payManaCostPrompt?.input.tappableLandIds)
          : undefined,
      untappableLandIds:
        chooseActionPrompt || payCombatCostPrompt || payManaCostPrompt
          ? (chooseActionPrompt?.input.untappableLandIds ??
            payCombatCostPrompt?.input.untappableLandIds ??
            payManaCostPrompt?.input.untappableLandIds)
          : undefined,
      manaAbilityOptions,
      hostileTargeting,
    }),
    [
      myPermanents,
      promptType,
      pendingAttackers,
      blockAssignments,
      promptAttackerIds,
      selectableBattlefieldCardIds,
      chooseActionPrompt,
      payCombatCostPrompt,
      payManaCostPrompt,
      manaAbilityOptions,
      hostileTargeting,
    ],
  );

  const pixiHand = useMemo(
    (): import("@/pixi/types").HandState => ({
      cards: myHand,
      draggingCardId,
      castingCardId,
      selectionMode: handSelectionMode,
      selectedIds: handSelectedIds,
    }),
    [myHand, draggingCardId, castingCardId, handSelectionMode, handSelectedIds],
  );

  const pixiCallbacks = useMemo(
    (): GameCanvasCallbacks => ({
      onClickCard:
        promptType === "chooseAction" ||
        promptType === "chooseAttackers" ||
        promptType === "chooseBlockers" ||
        promptType === "chooseTargetCard" ||
        promptType === "chooseTargetCardFromZone" ||
        promptType === "chooseTargetAny"
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
    ],
  );

  const opponentStopsMap = usePhaseStopStore((s) => s.opponentStops);
  const toggleOpponentStop = usePhaseStopStore((s) => s.toggleOpponentStop);

  const pixiPhaseStrip = useMemo((): import("@/pixi/PhaseStripLayer").PhaseStripState => {
    // Build per-opponent enabled phases map
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

  // ── Unified single-canvas board ──
  const boardArrangement = usePreferencesStore((s) => s.boardArrangement);
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

  // Per-opponent column widths (row arrangement resize grips). Equal split
  // until the user drags a boundary; reset implicitly when the count changes
  // (length mismatch → BoardCanvas falls back to equal).
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
    selectableBattlefieldCardIds,
    hostileTargeting,
  ]);

  // On the unified board the self region is offset (e.g. the perimeter
  // arrangement puts it in the center column), so anchor the panel to the
  // self region's left edge rather than the container corner.
  const selfPanelLeftPx = (unifiedLayout?.self?.x ?? 0) + 8;
  // The hand fan is centered in the self region; cap the cluster so its
  // right edge stays left of the hand's left edge. Measured against the
  // self region's half-width (not the board's), so it stays clear in the
  // perimeter arrangement where the self column is narrower than the board.
  const selfHalfWidthPx = (unifiedLayout?.self?.width ?? 0) / 2;
  const clusterMaxWidthPx = Math.max(
    CLUSTER_MIN_WIDTH_PX,
    selfHalfWidthPx - handWidth / 2 - CLUSTER_GAP_FROM_HAND_PX - 8,
  );
  // Perimeter (wrap-around) seats the self cluster MTGA-style: avatar + mana
  // on the far left, zone tiles on the far right, hand centered between.
  const selfIsSplit = boardArrangement === "perimeter";
  const selfRect = unifiedLayout?.self;
  const selfPanel = (
    <div
      className="absolute bottom-2 z-30 pointer-events-none origin-bottom-left"
      style={
        selfIsSplit && selfRect
          ? {
              left: selfRect.x + 8,
              width: (selfRect.width - 16) / SELF_PANEL_SCALE,
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
        isActiveTurn={activePlayerId === me.id}
        isPriorityPlayer={priorityPlayerId === me.id}
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
        draggingCardId={draggingCardId}
        onHoverCard={(card, e) => onHoverCard(card, e, { useAnchor: true })}
        onOpenCommandZone={() => {
          if ((myCommandZone?.length ?? 0) > 0) {
            if (isTargetingPrompt && commandTargetIds.length > 0) {
              onOpenZone("Your Command Zone", myCommandZone!, onTargetFromZone, commandTargetIds);
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
          if (isTargetingPrompt && graveyardTargetIds.length > 0) {
            onOpenZone("Your Graveyard", graveyard, onTargetFromZone, graveyardTargetIds);
            return;
          }
          if (
            promptType === "chooseTargetCardFromZone" &&
            chooseTargetCardFromZonePrompt?.input.zone === "Graveyard"
          ) {
            onReopenZoneTarget();
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
            onOpenZone("Your Exile", exile, onTargetFromZone, exileTargetIds);
            return;
          }
          if (
            promptType === "chooseTargetCardFromZone" &&
            chooseTargetCardFromZonePrompt?.input.zone === "Exile"
          ) {
            onReopenZoneTarget();
            return;
          }
          if (exilePlayableIds.length > 0 && promptType === "chooseAction") {
            onOpenZoneAndCast("Your Exile", exile, (_cardId) => {}, exilePlayableIds);
          } else {
            onOpenZone("Your Exile", exile);
          }
        }}
        hasPlayableInGraveyard={
          promptType === "chooseAction" && graveyard.some((c) => c.isPlayable)
        }
        hasPlayableInExile={promptType === "chooseAction" && exile.some((c) => c.isPlayable)}
        hasTargetInGraveyard={isTargetingPrompt && graveyardTargetIds.length > 0}
        hasTargetInExile={isTargetingPrompt && exileTargetIds.length > 0}
        targetHostile={hostileTargeting}
        zonePanelOrder={zonePanelOrder}
      />
    </div>
  );

  // Reserve hand-fan space at the bottom corners so the centered hand clears
  // the split self cluster (avatar left, zone tiles right). Row keeps the full
  // width (the capped cluster handles its own clearance there).
  const handInsets = useMemo(() => {
    if (boardArrangement !== "perimeter") return { left: 0, right: 0 };
    const zoneTileCount = 3 + ((myCommandZone?.length ?? 0) > 0 ? 1 : 0);
    const tileStridePx = 72 + 10;
    return {
      left: 130,
      right: Math.round(zoneTileCount * tileStridePx * SELF_PANEL_SCALE) + 20,
    };
  }, [boardArrangement, myCommandZone?.length]);

  const unifiedCombatBlocks = useMemo(() => {
    const byBlocker = new Map<string, string>();
    for (const a of combatAssignments ?? []) byBlocker.set(a.blockerId, a.attackerId);
    if (promptType === "chooseBlockers") {
      for (const a of blockAssignments) byBlocker.set(a.blockerId, a.attackerId);
    }
    return [...byBlocker].map(([blockerId, attackerId]) => ({ blockerId, attackerId }));
  }, [combatAssignments, blockAssignments, promptType]);

  return (
    <div
      ref={boardRef}
      className="game-board-surface relative flex flex-col min-h-0 flex-1 overflow-hidden"
    >
      <ReconnectBanner />
      <div className="absolute inset-0 z-10 overflow-hidden">
        <BoardCanvas
          regions={unifiedRegions}
          hand={pixiHand}
          arrowSpecs={arrowSpecs ?? []}
          combatBlocks={unifiedCombatBlocks}
          phaseStrip={pixiPhaseStrip}
          phaseStripCallbacks={pixiPhaseStripCallbacks}
          arrangement={boardArrangement}
          selfHeightFraction={unifiedSplit}
          opponentFractions={opponentFractions}
          callbacks={pixiCallbacks}
          externalBlockers={pixiExternalBlockers}
          handInsets={handInsets}
          isDropActive={isOverBattlefield}
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
        // Seat the panel against the player's edge: top opponents at the
        // region's top-left, side opponents vertically centered on their column.
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
          <div key={playerId} className="absolute z-30" style={panelStyle}>
            <PlayerPanel
              player={op}
              isOpponent
              seat={OPPONENT_SEATS[i] ?? "opponent1"}
              verticalAlign="top"
              zoneOrientation={
                orientation === "left" || orientation === "right" ? "vertical" : "horizontal"
              }
              isActiveTurn={activePlayerId === op.id}
              isPriorityPlayer={priorityPlayerId === op.id}
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
          className="absolute left-0 right-0 z-50 h-4 cursor-row-resize flex items-center justify-center group"
          style={{ top: unifiedLayout.self.y - 8 }}
          onPointerDown={onUnifiedGripDown}
        >
          <div className="h-1 w-24 rounded-full bg-white/30 group-hover:bg-white/60" />
        </div>
      )}
    </div>
  );
}
