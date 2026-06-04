import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import type { GameCard, OpponentZones, Player } from "@/types/manabrew";
import type { AgentPrompt } from "@/stores/useGameStore";
import { usePreferencesStore, type ZonePanelItem } from "@/stores/usePreferencesStore";
import { PixiGameCanvas } from "@/pixi/PixiGameCanvas";
import { PixiPhaseStripCanvas } from "@/pixi/PixiPhaseStripCanvas";
import type { BattlefieldState, GameCanvasCallbacks, ScreenBounds } from "@/pixi/types";
import { usePhaseStopStore } from "@/stores/usePhaseStopStore";
import type { PixiGameScene } from "@/pixi/PixiGameScene";
import type { PromptType } from "@/types/promptType";
import { PromptType as PT } from "@/types/promptType";
import { OpponentHalf, PlayerPanel } from "@/components/game/panels";
import type { PlacementGhost } from "@/components/game/game.types";
import { useHandScale } from "@/hooks/useHandScale";
import { HAND_CARD_BASES } from "@/components/game/game.styles";
import { computeBaseLayout, SIZE_PARAMS } from "@/pixi/HandLayout";
import type { HandActionOption } from "@/stores/useGameUIStore";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { ReconnectBanner } from "@/components/lobby/ReconnectBanner";

// Footprint of the bottom-right action cluster (PASS, Pass-Until-End,
// phase buttons). Matches MainActionOverlay's `w-[300px]` + its visible
// vertical extent so the battlefield doesn't auto-place or let the user
// drag cards underneath it.
// Only reserve space for the bottom-most mana pool strip — the prompt
// overlay now sits higher and doesn't block card placement.
const PASS_BUTTON_RESERVED = { width: 312, height: 50 } as const;

// Bottom-left player cluster (avatar + zone tiles + mana row). Sized to
// cover the panel's natural footprint so cards auto-place around it, but
// only the rows at the bottom are affected — the rest of the grid uses
// the full canvas width.
const PLAYER_CLUSTER_BLOCKER = { width: 420, height: 140 } as const;

const SELF_PANEL_SCALE = 0.85;

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
  opponentZones: Record<string, OpponentZones>;
  activePlayerId: string;
  priorityPlayerId: string;
  step: string;

  // Prompt state
  promptType?: PromptType;
  currentPrompt: AgentPrompt | null;

  // Combat state
  pendingAttackers: string[];
  pendingAttacker: string | null;
  selectedAttackDefenderId?: string | null;
  blockAssignments: { blockerId: string; attackerId: string }[];
  playerIsTargetable: (playerId: string) => boolean;

  // Per-player game-wide flags
  monarchId?: string | null;
  initiativeHolderId?: string | null;

  // Flash state
  turnFlashPlayerId: string | null;

  // Preferences
  zonePanelOrder: ZonePanelItem[];

  // Stack placement preview
  placementGhost?: PlacementGhost | null;

  // Battlefield drag state
  isOverBattlefield: boolean;
  battlefieldContainerRef: React.RefObject<HTMLDivElement | null>;
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
  onOpenZone: (title: string, cards: GameCard[], onClickCard?: (cardId: string) => void) => void;
  onOpenZoneAndCast: (
    title: string,
    cards: GameCard[],
    onClickCard: (cardId: string) => void,
  ) => void;
  onCastSpell: (cardId: string) => void;
  onTapLand?: (card: GameCard) => void;
  onTapLands?: (cardIds: string[]) => void;
  onTapLandAbility?: (cardId: string, abilityIndex: number, color?: string) => void;
  onUntapLand?: (card: GameCard) => void;
  onUntapLands?: (cardIds: string[]) => void;

  /** Out-ref populated with the live Pixi scene so Game.tsx can share it
   *  with the full-board PixiArrowsCanvas. */
  pixiSceneRef?: React.MutableRefObject<PixiGameScene | null>;

  /** Canvas-local keep-out rects (e.g. the StackDisplay panel when it is
   *  mounted) so battlefield cards beneath them move into a free cell. */
  pixiExternalBlockers?: ScreenBounds[];

  /** Per-opponent Pixi scene refs, keyed by player id. Each opponent's
   *  canvas writes into its ref once the scene is live, so the full-board
   *  arrow layer can resolve opponent sprite positions without DOM
   *  fallbacks. Provided by `Game.tsx` which maintains the ref bag. */
  getOpponentPixiSceneRef?: (playerId: string) => React.MutableRefObject<PixiGameScene | null>;

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
  opponentZones,
  activePlayerId,
  priorityPlayerId,
  step,
  promptType,
  currentPrompt,
  pendingAttackers,
  pendingAttacker,
  selectedAttackDefenderId,
  blockAssignments,
  playerIsTargetable,
  monarchId,
  initiativeHolderId,
  turnFlashPlayerId,
  zonePanelOrder,
  placementGhost,
  isOverBattlefield,
  battlefieldContainerRef,
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
  onCastSpell,
  onTapLand,
  onTapLands,
  onTapLandAbility,
  onUntapLand,
  onUntapLands,
  pixiSceneRef,
  pixiExternalBlockers,
  getOpponentPixiSceneRef,
  handSelectionMode,
  handSelectedIds,
  onHandCardToggle,
}: GameBoardProps) {
  const selfStops = usePhaseStopStore((s) => s.selfStops);
  const toggleSelfStop = usePhaseStopStore((s) => s.toggleSelfStop);

  const handSize = usePreferencesStore((s) => s.handSize);
  const vScale = useHandScale();
  // Reserve the visible portion of the hand for drag clamping. The hand
  // now sits lower (45% of card clipped below zone), so the reserved
  // strip is thinner — roughly 35% of the container height.
  const handBottomReserved = Math.round(HAND_CARD_BASES[handSize].containerH * vScale * 0.35);

  const handWidth = useMemo(() => {
    if (myHand.length === 0) return 0;
    const base = HAND_CARD_BASES[handSize];
    const params = SIZE_PARAMS[handSize];
    const cardW = Math.round(base.cardW * vScale);
    const layout = computeBaseLayout(
      myHand.length,
      cardW,
      Math.round(params.maxSpread * vScale),
      Math.round(params.minSpread * vScale),
      Math.round(params.spreadWidth * vScale),
    );
    if (layout.length === 0) return 0;
    const xs = layout.map((slot) => slot.x);
    return Math.max(...xs) - Math.min(...xs) + cardW;
  }, [handSize, myHand.length, vScale]);

  const CLUSTER_GAP_FROM_HAND_PX = 12;
  const CLUSTER_MIN_WIDTH_PX = 120;
  const clusterMaxWidthCss = useMemo(() => {
    // `calc(50% - handHalf - gap - left-pad)` keeps the cluster's right
    // edge comfortably left of the hand's left edge at every battlefield
    // width. Falls back to 50%- if we haven't measured the hand yet.
    const handHalf = handWidth / 2;
    const pad = CLUSTER_GAP_FROM_HAND_PX + 8;
    return `max(${CLUSTER_MIN_WIDTH_PX}px, calc(50% - ${handHalf + pad}px))`;
  }, [handWidth]);
  const hostileTargeting = currentPrompt?.hostile ?? false;
  const pixiBattlefield = useMemo(
    (): BattlefieldState => ({
      cards: myPermanents,
      pendingCardIds:
        promptType === PT.ChooseAttackers
          ? pendingAttackers
          : promptType === PT.ChooseBlockers
            ? blockAssignments.map((a) => a.blockerId)
            : undefined,
      attackingCardIds: currentPrompt?.attackerIds,
      tappableLandIds:
        promptType === PT.ChooseAction ||
        promptType === PT.PayCombatCost ||
        promptType === PT.PayManaCost
          ? (currentPrompt?.tappableLandIds ?? [])
          : undefined,
      untappableLandIds:
        promptType === PT.ChooseAction ||
        promptType === PT.PayCombatCost ||
        promptType === PT.PayManaCost
          ? (currentPrompt?.untappableLandIds ?? [])
          : undefined,
      manaAbilityOptions:
        promptType === PT.ChooseAction || promptType === PT.PayManaCost
          ? (currentPrompt?.manaAbilityOptions ?? [])
          : undefined,
      hostileTargeting,
    }),
    [myPermanents, promptType, pendingAttackers, blockAssignments, currentPrompt, hostileTargeting],
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
        promptType === PT.ChooseAction ||
        promptType === PT.ChooseAttackers ||
        promptType === PT.ChooseBlockers ||
        promptType === PT.ChooseTargetCard ||
        promptType === PT.ChooseTargetCardFromZone ||
        promptType === PT.ChooseTargetAny
          ? onBattlefieldClick
          : undefined,
      onHoverCard: (card, bounds) => {
        if (!card) {
          onHoverCard(null);
          return;
        }
        if (bounds) {
          const syntheticEvent = {
            clientX: bounds.x + bounds.width / 2,
            clientY: bounds.y,
            buttons: 0,
            currentTarget: document.createElement("div"),
            shiftKey: false,
            altKey: false,
            ctrlKey: false,
            metaKey: false,
          } as unknown as React.MouseEvent;
          onHoverCard(card, syntheticEvent, {
            useAnchor: true,
            anchorOverride: {
              left: bounds.x,
              right: bounds.x + bounds.width,
              top: bounds.y,
              bottom: bounds.y + bounds.height,
              width: bounds.width,
              height: bounds.height,
              x: bounds.x,
              y: bounds.y,
              toJSON: () => ({}),
            } as DOMRect,
          });
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

  // ── Resizable split via custom drag handle on phase strip left edge ──
  const [splitPct, setSplitPct] = useState(45); // opponent % of total height
  const boardRef = useRef<HTMLDivElement>(null);

  const onGripPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const el = boardRef.current;
    if (!el) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const y = ev.clientY - rect.top;
      const pct = Math.max(20, Math.min(80, (y / rect.height) * 100));
      setSplitPct(pct);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  return (
    <div
      ref={boardRef}
      className="game-board-surface relative flex flex-col min-h-0 flex-1 overflow-visible"
    >
      <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
        <ReconnectBanner className="shadow-sm bg-background/95" />
      </div>

      {/* ── Split: opponent (top) / phase strip / me (bottom) ─── */}

      {/* Opponent half */}
      <div style={{ flex: `${splitPct} 1 0%` }} className="min-h-0 overflow-visible">
        {opponents.length <= 1 ? (
          <OpponentHalf
            player={opponents[0]!}
            opponentIndex={0}
            permanents={opponentPermanentsByPlayer.get(opponents[0]!.id) ?? []}
            graveyard={opponentZones[opponents[0]!.id]?.graveyard ?? []}
            exile={opponentZones[opponents[0]!.id]?.exile ?? []}
            commandZone={opponentZones[opponents[0]!.id]?.commandZone}
            isTargetable={playerIsTargetable(opponents[0]!.id)}
            isSelectedTarget={selectedAttackDefenderId === opponents[0]!.id}
            onTarget={() => onTargetPlayer(opponents[0]!.id)}
            isFlashing={turnFlashPlayerId === opponents[0]?.id}
            isMonarch={monarchId === opponents[0]?.id}
            hasInitiative={initiativeHolderId === opponents[0]?.id}
            activePlayerId={activePlayerId}
            priorityPlayerId={priorityPlayerId}
            step={step}
            promptType={promptType}
            pendingAttacker={pendingAttacker}
            attackerIds={currentPrompt?.attackerIds}
            onClickCard={onBattlefieldClick}
            onClickAnyCard={onAttackerClick}
            onHoverCard={(card, e, opts) => onHoverCard(card, e, { useAnchor: true, ...opts })}
            onFlipCard={onFlipCard}
            onOpenZone={onOpenZone}
            zonePanelOrder={zonePanelOrder}
            hostileTargeting={hostileTargeting}
            manaAbilityOptions={currentPrompt?.manaAbilityOptions}
            pixiSceneRef={getOpponentPixiSceneRef?.(opponents[0]!.id)}
          />
        ) : (
          <ResizablePanelGroup orientation="horizontal">
            {opponents.map((op, i) => (
              <Fragment key={op.id}>
                {i > 0 && <ResizableHandle />}
                <ResizablePanel className="overflow-visible">
                  <OpponentHalf
                    player={op}
                    opponentIndex={i}
                    permanents={opponentPermanentsByPlayer.get(op.id) ?? []}
                    graveyard={opponentZones[op.id]?.graveyard ?? []}
                    exile={opponentZones[op.id]?.exile ?? []}
                    commandZone={opponentZones[op.id]?.commandZone}
                    isTargetable={playerIsTargetable(op.id)}
                    isSelectedTarget={selectedAttackDefenderId === op.id}
                    onTarget={() => onTargetPlayer(op.id)}
                    isFlashing={turnFlashPlayerId === op.id}
                    isMonarch={monarchId === op.id}
                    hasInitiative={initiativeHolderId === op.id}
                    activePlayerId={activePlayerId}
                    priorityPlayerId={priorityPlayerId}
                    step={step}
                    promptType={promptType}
                    pendingAttacker={pendingAttacker}
                    attackerIds={currentPrompt?.attackerIds}
                    onClickCard={onBattlefieldClick}
                    onClickAnyCard={onAttackerClick}
                    onHoverCard={(card, e, opts) =>
                      onHoverCard(card, e, { useAnchor: true, ...opts })
                    }
                    onFlipCard={onFlipCard}
                    onOpenZone={onOpenZone}
                    zonePanelOrder={zonePanelOrder}
                    hostileTargeting={hostileTargeting}
                    manaAbilityOptions={currentPrompt?.manaAbilityOptions}
                    pixiSceneRef={getOpponentPixiSceneRef?.(op.id)}
                  />
                </ResizablePanel>
              </Fragment>
            ))}
          </ResizablePanelGroup>
        )}
      </div>

      {/* Phase strip — the center line with resize grip on the left */}
      <div className="h-20 w-full shrink-0 relative">
        {/* Resize grip — overlaid on the left, above the phase strip */}
        <div
          className="absolute left-2 top-0 h-full w-10 cursor-row-resize z-20 flex items-center justify-center"
          onPointerDown={onGripPointerDown}
        >
          <div className="flex flex-col items-center gap-[3px]">
            <div className="w-4 h-[2px] rounded-full bg-white/25" />
            <div className="w-6 h-[2px] rounded-full bg-white/35" />
            <div className="w-4 h-[2px] rounded-full bg-white/25" />
          </div>
        </div>
        {/* Phase strip — full width, centered */}
        <div className="absolute inset-0">
          <PixiPhaseStripCanvas state={pixiPhaseStrip} callbacks={pixiPhaseStripCallbacks} />
        </div>
      </div>

      {/* Player half */}
      <div style={{ flex: `${100 - splitPct} 1 0%` }} className="min-h-0 overflow-visible">
        <div className="flex flex-col h-full overflow-visible">
          <div className="flex flex-1 min-h-0 overflow-visible">
            <div
              ref={battlefieldContainerRef}
              className={cn("relative flex flex-col flex-1 min-w-0 overflow-visible")}
            >
              {/* Cluster is given a `max-width` (not explicit width)
                    driven by a ResizeObserver on the hand container.
                    The container sizes to its content naturally, so
                    there's no empty gutter at the right — but the cap
                    triggers `flex-wrap` once the zones + avatar would
                    start overlapping the hand. */}
              <div
                className="absolute bottom-2 left-2 z-30 pointer-events-none origin-bottom-left"
                style={{
                  maxWidth: `calc((${clusterMaxWidthCss}) / ${SELF_PANEL_SCALE})`,
                  transform: `scale(${SELF_PANEL_SCALE})`,
                }}
              >
                <PlayerPanel
                  player={me}
                  isOpponent={false}
                  seat="self"
                  verticalAlign="bottom"
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
                      const hasPlayable = myCommandZone!.some((c) => c.isPlayable);
                      if (hasPlayable && promptType === PT.ChooseAction) {
                        onOpenZoneAndCast("Your Command Zone", myCommandZone!, (_cardId) => {});
                      } else {
                        onOpenZone("Your Command Zone", myCommandZone!);
                      }
                    }
                  }}
                  onOpenGraveyard={() => {
                    const hasPlayable = graveyard.some((c) => c.isPlayable);
                    if (hasPlayable && promptType === PT.ChooseAction) {
                      onOpenZoneAndCast("Your Graveyard", graveyard, (_cardId) => {});
                    } else {
                      onOpenZone("Your Graveyard", graveyard);
                    }
                  }}
                  onOpenExile={() => {
                    const hasPlayable = exile.some((c) => c.isPlayable);
                    if (hasPlayable && promptType === PT.ChooseAction) {
                      onOpenZoneAndCast("Your Exile", exile, (_cardId) => {});
                    } else {
                      onOpenZone("Your Exile", exile);
                    }
                  }}
                  hasPlayableInGraveyard={
                    promptType === PT.ChooseAction && graveyard.some((c) => c.isPlayable)
                  }
                  hasPlayableInExile={
                    promptType === PT.ChooseAction && exile.some((c) => c.isPlayable)
                  }
                  zonePanelOrder={zonePanelOrder}
                />
              </div>
              <div className="absolute inset-0 z-10 overflow-hidden">
                <PixiGameCanvas
                  battlefield={pixiBattlefield}
                  hand={pixiHand}
                  sceneRef={pixiSceneRef}
                  placementGhostName={
                    placementGhost?.controllerId === me.id ? placementGhost.cardName : null
                  }
                  isDropActive={isOverBattlefield}
                  callbacks={pixiCallbacks}
                  bottomReserved={handBottomReserved}
                  bottomLeftReserved={PLAYER_CLUSTER_BLOCKER}
                  getHandActions={getHandActions}
                  onSelectHandAction={(_card, action) => onSelectHandAction?.(action)}
                  bottomRightReserved={PASS_BUTTON_RESERVED}
                  externalBlockers={pixiExternalBlockers}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
