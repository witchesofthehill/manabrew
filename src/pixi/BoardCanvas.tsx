import { useRef, useEffect, useCallback, useState } from "react";
import { Application } from "pixi.js";
import { destroyPixiApp, installPixiPatches } from "./pixiPatches";

// Runtime workarounds for Pixi v8 bugs — must run before any `Application`.
installPixiPatches();

import { BoardScene, type BoardPlayerSpec } from "./board/BoardScene";
import { computeBoardLayout, type RegionOrientation } from "./board/boardLayout";
import type { PlayerHudSpec as PlayerBarSpec } from "./hud/playerHud.types";
import type { ZoneTileSpec } from "./board/BoardZoneTiles";
import { battlefieldScaleForMultiplier, combatRowReserve, maxScaleForRows } from "./GridLayout";
import { playmatPad } from "./board/PlaymatLayer";
import { setPixiTextStyleTheme } from "./textStyles";
import { getTheme } from "@/hooks/useTheme";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { isCoarsePointer } from "@/lib/responsive";
import { registerPixiApp } from "./visibility";
import {
  BATTLEFIELD_CARD_SCALE_FLOOR,
  BATTLEFIELD_CARD_SCALE_FLOOR_COMPACT,
  BATTLEFIELD_MIN_ROWS,
  HAND_ACTIONS_CLEAR_DELAY_MS,
  HAND_ACTIONS_GAP_PX,
  PIXI_MAX_FPS,
  Z_HAND_ACTIONS_MENU,
} from "./constants";
import { CARD_H } from "@/components/game/game.constants";
import { HAND_CARD_BASE } from "@/components/game/game.styles";
import { HandCardActions } from "@/components/game/zones/HandCardActions";
import { useCardFaces } from "@/hooks/useCardFaces";
import { isHorizontalGameCard } from "@/lib/horizontalGameCard";
import { useKeybindings } from "@/hooks/useKeybindings";
import { useGameDevStore } from "@/stores/useGameDevStore";
import { setAnimationsEnabled } from "./effects/enabled";
import { withAlpha } from "@/themes/gameTheme";
import { RotateCw } from "lucide-react";

/** Matches HandCardActions `w-[220px]`. */
const HAND_ACTIONS_PANEL_W = 220;
import type { HandActionOption } from "@/stores/useGameUIStore";
import type { CardDto, PlaymatSettings } from "@/protocol/game";
import type { AttackTargetDto } from "@/protocol/prompts/common";
import type {
  ArrowSpec,
  BattlefieldState,
  GameCanvasCallbacks,
  HandState,
  PlayZoneRect,
  ScreenBounds,
} from "./types";
import type { PhaseStripCallbacks, PhaseStripState } from "./PhaseStripLayer";

export interface BoardCanvasRegion {
  playerId: string;
  isLocal: boolean;
  state: BattlefieldState;
  playmat?: string;
  playmatSettings?: PlaymatSettings;
  /** Seat colour (hex) for the hover highlight. */
  color?: string;
}

/** Canvas-local px == CSS px, so the parent can anchor React panels to each
 *  player's region. */
export interface BoardCanvasLayout {
  self: PlayZoneRect | null;
  /** Y of the center band where the phase strip is centered. */
  dividerY: number;
  /** Px from the canvas bottom up to the local player's playmat bottom edge
   *  (= hand-fan top). The action cluster is hard-capped to this so it can never
   *  render over the playmat. Mirrors `BoardScene.handReserveBottom`. */
  selfClusterMaxHeight: number;
  opponents: {
    playerId: string;
    rect: PlayZoneRect;
    orientation: RegionOrientation;
  }[];
}

interface BoardCanvasProps {
  regions: BoardCanvasRegion[];
  hand: HandState;
  arrowSpecs: ArrowSpec[];
  castingArrow?: { sourceCardId: string; hostile: boolean } | null;
  /** Local player is declaring blockers — enables drag-to-block. */
  declareBlockers?: boolean;
  combatBlocks?: { blockerId: string; attackerId: string }[];
  /** Local player is declaring attackers — enables drag-to-attack. */
  declareAttackers?: boolean;
  /** Legal defenders (player / planeswalker / battle) for the active
   *  `chooseAttackers` prompt, and per-attacker validity. */
  attackTargets?: AttackTargetDto[];
  attackerOptions?: { attackerId: string; validTargetIds: string[] }[];
  phaseStrip: PhaseStripState;
  phaseStripCallbacks?: PhaseStripCallbacks;
  /** Fraction of usable height for the local player's bottom region; defaults to
   *  the layout's built-in fraction when omitted. */
  selfHeightFraction?: number;
  compact?: boolean;
  /** The opponent whose field auto-expands (their turn), or `null` for an even
   *  split (our turn). The scene owns + eases the delimiters; this sets the
   *  target. */
  focusedOpponentId?: string | null;
  /** Opponents under attack this combat — expanded (even-split when several)
   *  over the turn focus so combat stays visible. */
  combatFocusIds?: string[];
  /** Keyboard-cycled single-opponent focus; wins over combat/turn focus. */
  manualFocusId?: string | null;
  /** Thin Pixi player bars over each opponent's field. `showPlayerBars` toggles
   *  them; `playerBars` carries the per-opponent name/life/colour/state. */
  playerBars?: PlayerBarSpec[];
  showPlayerBars?: boolean;
  /** On-grid zone tiles (deck/graveyard/exile/command) per player id. */
  zoneTiles?: Record<string, ZoneTileSpec[]>;
  /** Px the hand fan reserves at the bottom of the self region — subtracted from
   *  its height when sizing cards so ~3 rows always fit the free area. */
  selfBottomReserve?: number;
  callbacks: GameCanvasCallbacks;
  /** Bottom-corner keep-out widths for the hand fan so it centers in the gap. */
  handInsets?: { left: number; right: number };
  isDropActive?: boolean;
  /** Auto-arrange the battlefield into rows, ignoring manual drag placement. */
  autoSort?: boolean;
  sceneRef?: React.MutableRefObject<BoardScene | null>;
  getHandActions?: (card: CardDto) => HandActionOption[];
  onSelectHandAction?: (card: CardDto, action: HandActionOption) => void;
  onLayout?: (layout: BoardCanvasLayout) => void;
  className?: string;
}

interface HandHoverState {
  card: CardDto;
  bounds: ScreenBounds;
}

export function BoardCanvas({
  regions,
  hand,
  arrowSpecs,
  castingArrow,
  declareBlockers,
  combatBlocks,
  declareAttackers,
  attackTargets,
  attackerOptions,
  phaseStrip,
  phaseStripCallbacks,
  selfHeightFraction,
  compact,
  focusedOpponentId,
  combatFocusIds,
  manualFocusId,
  playerBars,
  showPlayerBars,
  zoneTiles,
  selfBottomReserve,
  callbacks,
  handInsets,
  isDropActive,
  autoSort,
  sceneRef: externalSceneRef,
  getHandActions,
  onSelectHandAction,
  onLayout,
  className,
}: BoardCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<Application | null>(null);
  const unregisterVisibilityRef = useRef<(() => void) | null>(null);
  const [scene, setScene] = useState<BoardScene | null>(null);
  const sceneRef = useRef<BoardScene | null>(null);
  const callbacksRef = useRef(callbacks);
  const onLayoutRef = useRef(onLayout);
  const reserveRef = useRef(0);
  const latestLayoutRef = useRef<BoardCanvasLayout | null>(null);
  const selfBottomReserveRef = useRef(selfBottomReserve ?? 0);

  const cardSizeMultiplier = usePreferencesStore((s) => s.cardSizeMultiplier);
  const cardStyle = usePreferencesStore((s) => s.battlefieldCardStyle);
  const lockZoneTiles = usePreferencesStore((s) => s.lockZoneTiles);

  const [handHover, setHandHover] = useState<HandHoverState | null>(null);
  const clearTimerRef = useRef<number | null>(null);
  const cancelHandHoverClear = useCallback(() => {
    if (clearTimerRef.current != null) {
      window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
  }, []);
  const scheduleHandHoverClear = useCallback(() => {
    cancelHandHoverClear();
    clearTimerRef.current = window.setTimeout(() => {
      setHandHover(null);
      clearTimerRef.current = null;
    }, HAND_ACTIONS_CLEAR_DELAY_MS);
  }, [cancelHandHoverClear]);

  useEffect(() => {
    sceneRef.current = scene;
    if (externalSceneRef) externalSceneRef.current = scene;
  }, [scene, externalSceneRef]);
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);
  useEffect(() => {
    onLayoutRef.current = onLayout;
  }, [onLayout]);
  useEffect(() => {
    selfBottomReserveRef.current = selfBottomReserve ?? 0;
  }, [selfBottomReserve]);

  const initApp = useCallback(async () => {
    if (!canvasRef.current || appRef.current) return;
    const app = new Application();
    appRef.current = app;
    try {
      await app.init({
        canvas: canvasRef.current,
        preference: "webgl",
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(2, window.devicePixelRatio || 1),
      });
    } catch (err) {
      console.error("[pixi] BoardCanvas init failed:", err);
      appRef.current = null;
      return;
    }
    if (!app.renderer) {
      appRef.current = null;
      return;
    }
    app.ticker.maxFPS = PIXI_MAX_FPS;
    unregisterVisibilityRef.current = registerPixiApp(app);

    const newScene = new BoardScene(app, {
      onClickCard: (...a) => callbacksRef.current.onClickCard?.(...a),
      onHoverCard: (...a) => callbacksRef.current.onHoverCard?.(...a),
      onClickAnyCard: (...a) => callbacksRef.current.onClickAnyCard?.(...a),
      onFlipCard: () => callbacksRef.current.onFlipCard?.(),
      onTapLand: (...a) => callbacksRef.current.onTapLand?.(...a),
      onTapLands: (...a) => callbacksRef.current.onTapLands?.(...a),
      onUntapLand: (...a) => callbacksRef.current.onUntapLand?.(...a),
      onUntapLands: (...a) => callbacksRef.current.onUntapLands?.(...a),
      onTapLandAbility: (...a) => callbacksRef.current.onTapLandAbility?.(...a),
      onAttackerClick: (...a) => callbacksRef.current.onAttackerClick?.(...a),
      onAssignBlock: (...a) => callbacksRef.current.onAssignBlock?.(...a),
      onUnassignBlock: (...a) => callbacksRef.current.onUnassignBlock?.(...a),
      onBlockDragChange: (...a) => callbacksRef.current.onBlockDragChange?.(...a),
      onAssignAttacker: (...a) => callbacksRef.current.onAssignAttacker?.(...a),
      onUnassignAttacker: (...a) => callbacksRef.current.onUnassignAttacker?.(...a),
      onAttackDragChange: (...a) => callbacksRef.current.onAttackDragChange?.(...a),
      onTargetPlayer: (...a) => callbacksRef.current.onTargetPlayer?.(...a),
      onShowPlayerSheet: (...a) => callbacksRef.current.onShowPlayerSheet?.(...a),
      onShowBoardMenu: (...a) => callbacksRef.current.onShowBoardMenu?.(...a),
      onHoverOpponent: (...a) => callbacksRef.current.onHoverOpponent?.(...a),
      onStartDrag: (...a) => callbacksRef.current.onStartDrag?.(...a),
      onClickCard_Hand: (...a) => callbacksRef.current.onClickCard_Hand?.(...a),
      onCastSpell: (...a) => callbacksRef.current.onCastSpell?.(...a),
      onDismissHoverPreview: () => callbacksRef.current.onDismissHoverPreview?.(),
      onHoverHandCard: (card, bounds) => {
        callbacksRef.current.onHoverHandCard?.(card, bounds);
        if (card && bounds) {
          cancelHandHoverClear();
          setHandHover({ card, bounds });
        } else {
          // Pixi already held the card for HAND_HOVER_HOLD_MS (moving onto the flip
          // button / panel cancels it), so a null here means the cursor truly left —
          // clear in sync with the card instead of adding a second grace.
          cancelHandHoverClear();
          setHandHover(null);
        }
      },
    });

    const theme = getTheme();
    setPixiTextStyleTheme(theme);
    newScene.setTheme(theme);

    const parent = canvasRef.current.parentElement;
    if (parent) newScene.resize(parent.clientWidth, parent.clientHeight);
    newScene.setOnHandReserveChange((px) => {
      reserveRef.current = px;
      const base = latestLayoutRef.current;
      if (!base) return;
      const updated = { ...base, selfClusterMaxHeight: Math.max(px, selfBottomReserveRef.current) };
      latestLayoutRef.current = updated;
      onLayoutRef.current?.(updated);
    });
    setScene(newScene);
  }, [cancelHandHoverClear]);

  useEffect(() => {
    let active = true;
    initApp().then(() => {
      if (!active) {
        sceneRef.current?.destroy();
        sceneRef.current = null;
        unregisterVisibilityRef.current?.();
        unregisterVisibilityRef.current = null;
        destroyPixiApp(appRef.current);
        appRef.current = null;
        setScene(null);
      }
    });
    return () => {
      active = false;
      sceneRef.current?.destroy();
      sceneRef.current = null;
      unregisterVisibilityRef.current?.();
      unregisterVisibilityRef.current = null;
      destroyPixiApp(appRef.current);
      appRef.current = null;
      setScene(null);
    };
  }, [initApp]);

  const players: BoardPlayerSpec[] = regions.map((r) => ({
    playerId: r.playerId,
    isLocal: r.isLocal,
    playmat: r.playmat,
    playmatSettings: r.playmatSettings,
    color: r.color,
  }));
  const playersKey = players
    .map(
      (p) =>
        `${p.playerId}:${p.isLocal ? 1 : 0}:${p.playmat ? 1 : 0}:${p.color ?? ""}:${JSON.stringify(p.playmatSettings ?? {})}`,
    )
    .join(",");
  const opponentIds = regions.filter((r) => !r.isLocal).map((r) => r.playerId);

  const reconfigure = useCallback(() => {
    const app = appRef.current;
    const s = sceneRef.current;
    if (!app?.renderer || !s) return;
    const w = app.renderer.width;
    const h = app.renderer.height;
    const opponentCount = opponentIds.length;
    const layout = computeBoardLayout(w, h, opponentCount, selfHeightFraction, compact ?? false);
    s.setCompactMode(compact ?? false);
    // Each region is scaled to fill its OWN height — a single shared scale let
    // the tightest field (self, after the hand-fan reserve) shrink everyone, so
    // the roomier opponent fields wasted space. Every field follows the card
    // size multiplier (100% = 3-row board), clamped per field to a single-row
    // fill; compact locks to 3 rows regardless.
    const scaleFloor = compact
      ? BATTLEFIELD_CARD_SCALE_FLOOR_COMPACT
      : BATTLEFIELD_CARD_SCALE_FLOOR;
    // The region's playArea insets the usable zone by the playmat pad on every
    // edge before laying rows; compact subtracts it here too, or the 3-row
    // scale overshoots and the grid floors to 2 rows.
    const playmatTrim = (usable: number, width: number) =>
      compact ? Math.max(1, usable - playmatPad(width, usable) * 2) : usable;
    const selfUsable = playmatTrim(
      Math.max(1, layout.self.height - (selfBottomReserve ?? 0)),
      layout.self.width,
    );
    const compactSelfBand = combatRowReserve(maxScaleForRows(selfUsable, BATTLEFIELD_MIN_ROWS));
    const selfScale = compact
      ? Math.max(
          scaleFloor,
          maxScaleForRows(Math.max(1, selfUsable - compactSelfBand), BATTLEFIELD_MIN_ROWS),
        )
      : battlefieldScaleForMultiplier(selfUsable, cardSizeMultiplier);
    // No top reserve: the opponent HUD is a keep-out blocker, so the grid uses
    // the full field height (the avatar's top-left cells are blocked instead).
    const oppUsables = layout.opponents.map((o) =>
      playmatTrim(Math.max(1, o.rect.height), o.rect.width),
    );
    const oppUsable = oppUsables.length ? Math.min(...oppUsables) : selfUsable;
    const compactOppBand = combatRowReserve(maxScaleForRows(oppUsable, BATTLEFIELD_MIN_ROWS));
    const oppScale = compact
      ? Math.max(
          scaleFloor,
          maxScaleForRows(Math.max(1, oppUsable - compactOppBand), BATTLEFIELD_MIN_ROWS),
        )
      : battlefieldScaleForMultiplier(oppUsable, cardSizeMultiplier);
    s.configure(players, layout, { self: selfScale, opponent: oppScale });
    // The hand fan holds its classic (authored) size and the battlefield grows
    // up to meet it — the fan only enlarges past that on displays tall enough
    // for battlefield cards to outgrow it. Applied after configure so a
    // rebuilt HandController picks it up and the zone-height cap re-evaluates.
    s.setHandScale(Math.max(1, (selfScale * CARD_H) / HAND_CARD_BASE.cardH));
    const next: BoardCanvasLayout = {
      self: layout.self,
      dividerY: layout.dividerY,
      selfClusterMaxHeight: Math.max(reserveRef.current, selfBottomReserve ?? 0),
      opponents: opponentIds.map((id, i) => ({
        playerId: id,
        rect: layout.opponents[i]?.rect ?? layout.self,
        orientation: layout.opponents[i]?.orientation ?? "top",
      })),
    };
    latestLayoutRef.current = next;
    onLayoutRef.current?.(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    playersKey,
    cardSizeMultiplier,
    selfHeightFraction,
    compact,
    selfBottomReserve,
    showPlayerBars,
  ]);

  useEffect(() => {
    reconfigure();
  }, [reconfigure, scene]);

  useEffect(() => {
    const parent = canvasRef.current?.parentElement;
    if (!parent || !scene) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          scene.resize(width, height);
          reconfigure();
        }
      }
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, [scene, reconfigure]);

  // Push only the regions whose state object actually changed (the parent may
  // re-create the `regions` array on unrelated renders); reset on a new scene so
  // it gets fully seeded.
  const lastRegionStateRef = useRef(new Map<string, BattlefieldState>());
  const lastRegionSceneRef = useRef<BoardScene | null>(null);
  useEffect(() => {
    if (!scene) return;
    const seeding = lastRegionSceneRef.current !== scene;
    if (seeding) {
      lastRegionStateRef.current.clear();
      lastRegionSceneRef.current = scene;
    }
    for (const r of regions) {
      if (!seeding && lastRegionStateRef.current.get(r.playerId) === r.state) continue;
      lastRegionStateRef.current.set(r.playerId, r.state);
      scene.updateRegionState(r.playerId, r.state);
    }
    const liveIds = new Set<string>();
    for (const r of regions) for (const c of r.state.cards) liveIds.add(c.id);
    scene.pruneCardPositions(liveIds);
  }, [scene, regions]);

  useEffect(() => {
    scene?.setOpponentFocus(focusedOpponentId ?? null);
  }, [scene, focusedOpponentId]);

  useEffect(() => {
    scene?.setCombatFocus(combatFocusIds ?? []);
  }, [scene, combatFocusIds]);

  useEffect(() => {
    scene?.setManualFocus(manualFocusId ?? null);
  }, [scene, manualFocusId]);

  useEffect(() => {
    scene?.setPlayerBars(playerBars ?? [], showPlayerBars ?? false);
  }, [scene, playerBars, showPlayerBars]);

  useEffect(() => {
    scene?.setZoneTiles(zoneTiles ?? {});
  }, [scene, zoneTiles]);

  useEffect(() => {
    scene?.updateHand(hand);
  }, [scene, hand]);

  useEffect(() => {
    scene?.setArrowSpecs(arrowSpecs);
  }, [scene, arrowSpecs]);

  useEffect(() => {
    scene?.setCastingArrow(castingArrow ?? null);
  }, [scene, castingArrow]);

  useEffect(() => {
    scene?.setDeclareBlockers(declareBlockers ?? false);
  }, [scene, declareBlockers]);

  useEffect(() => {
    scene?.setDeclareAttackers(
      declareAttackers ?? false,
      attackTargets ?? [],
      attackerOptions ?? [],
    );
  }, [scene, declareAttackers, attackTargets, attackerOptions]);

  useEffect(() => {
    scene?.applyCombatBlocks(combatBlocks ?? []);
  }, [scene, combatBlocks, regions]);

  useEffect(() => {
    scene?.setPhaseStripState(phaseStrip);
  }, [scene, phaseStrip]);

  useEffect(() => {
    if (phaseStripCallbacks) scene?.setPhaseStripCallbacks(phaseStripCallbacks);
  }, [scene, phaseStripCallbacks]);

  useEffect(() => {
    scene?.setHandInsets(handInsets?.left ?? 0, handInsets?.right ?? 0);
  }, [scene, handInsets?.left, handInsets?.right]);

  useEffect(() => {
    scene?.setDropActive(isDropActive ?? false);
  }, [scene, isDropActive]);

  useEffect(() => {
    scene?.setAutoSort(autoSort ?? false);
  }, [scene, autoSort]);

  useEffect(() => {
    scene?.setCardStyle(cardStyle);
  }, [scene, cardStyle]);

  useEffect(() => {
    scene?.setZoneTilesLocked(lockZoneTiles);
  }, [scene, lockZoneTiles]);

  useEffect(() => {
    if (!scene) return;
    return usePreferencesStore.subscribe(() => {
      const theme = getTheme();
      setPixiTextStyleTheme(theme);
      scene.setTheme(theme);
    });
  }, [scene]);

  const handActions = handHover && getHandActions ? getHandActions(handHover.card) : [];
  const showActionPanel =
    handHover && handActions.length > 0 && !!onSelectHandAction && !isCoarsePointer();

  const hoverFaces = useCardFaces({
    name: handHover?.card.identity.name,
    setCode: handHover?.card.identity.setCode,
    cardNumber: handHover?.card.identity.cardNumber,
  });
  const hoverHorizontal = !!handHover && isHorizontalGameCard(handHover.card);
  const [handFlipBack, setHandFlipBack] = useState(false);
  const [handFlippedHorizontal, setHandFlippedHorizontal] = useState(false);
  const hoverCardId = handHover?.card.id ?? null;
  useEffect(() => {
    setHandFlipBack(false);
    setHandFlippedHorizontal(false);
  }, [hoverCardId]);
  const showHandFlip = !!handHover && (hoverFaces.isFlippable || hoverHorizontal);
  const showHoverAreas = useGameDevStore((s) => s.showHoverAreas);

  useEffect(() => {
    scene?.setHoverDebug(showHoverAreas);
  }, [scene, showHoverAreas]);

  const showGridSkeleton = useGameDevStore((s) => s.showGridSkeleton);

  useEffect(() => {
    scene?.setGridSkeletonDebug(showGridSkeleton);
  }, [scene, showGridSkeleton]);

  const showAttackRows = useGameDevStore((s) => s.showAttackRows);

  useEffect(() => {
    scene?.setAttackRowDebug(showAttackRows);
  }, [scene, showAttackRows]);

  const inGameAnimations = usePreferencesStore((s) => s.inGameAnimations);
  useEffect(() => {
    setAnimationsEnabled(inGameAnimations);
  }, [inGameAnimations]);

  const etbPreviewVersion = useGameDevStore((s) => s.etbGlowVersion);
  useEffect(() => {
    if (etbPreviewVersion > 0) scene?.previewEtb();
  }, [scene, etbPreviewVersion]);

  const toggleHandFlip = useCallback(() => {
    if (hoverHorizontal) {
      setHandFlippedHorizontal((prev) => {
        const next = !prev;
        sceneRef.current?.setHandFlippedHorizontal(next);
        return next;
      });
      return;
    }
    setHandFlipBack((prev) => {
      const next = !prev;
      sceneRef.current?.setHandPreviewFace(next ? 1 : 0);
      return next;
    });
  }, [sceneRef, hoverHorizontal]);

  useKeybindings({
    "flip-card": () => {
      if (showHandFlip) toggleHandFlip();
    },
  });

  return (
    <div className={className} style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }}
        onContextMenu={(e) => e.preventDefault()}
      />
      {showHandFlip && (
        <div
          className="pointer-events-none absolute flex justify-end p-1.5"
          style={{
            left: handHover.bounds.x,
            top: handHover.bounds.y,
            width: handHover.bounds.width,
            zIndex: Z_HAND_ACTIONS_MENU,
          }}
        >
          <button
            type="button"
            className="pointer-events-auto relative inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white shadow hover:bg-black/85 pointer-coarse:before:absolute pointer-coarse:before:-inset-2.5 pointer-coarse:before:content-['']"
            title={
              hoverHorizontal ? "Rotate the card to read it" : "Flip card to view the other face"
            }
            onMouseEnter={() => {
              cancelHandHoverClear();
              sceneRef.current?.holdHandHover();
            }}
            onMouseLeave={() => {
              scheduleHandHoverClear();
              sceneRef.current?.releaseHandHover();
            }}
            onClick={(e) => {
              e.stopPropagation();
              toggleHandFlip();
            }}
          >
            <RotateCw className="h-3 w-3" />
            {hoverHorizontal
              ? handFlippedHorizontal
                ? "Upright"
                : "Read"
              : handFlipBack
                ? "Front"
                : "Back"}
          </button>
        </div>
      )}
      {showActionPanel && (
        <>
          {/* Curved hover bridge: its border-radius clips the hit region so the
              cursor can travel from the lifted card to the action panel without
              dropping the hover. Transparent in play; tinted by the dev overlay. */}
          <div
            style={{
              position: "absolute",
              left: handHover.bounds.x + handHover.bounds.width,
              top: handHover.bounds.y,
              width: HAND_ACTIONS_GAP_PX + HAND_ACTIONS_PANEL_W,
              height: handHover.bounds.height,
              borderBottomRightRadius: "100%",
              backgroundColor: showHoverAreas
                ? withAlpha(getTheme().gameTheme.success, 0.28)
                : "transparent",
              zIndex: Z_HAND_ACTIONS_MENU - 1,
            }}
            onMouseEnter={() => {
              cancelHandHoverClear();
              sceneRef.current?.holdHandHover();
            }}
            onMouseLeave={() => {
              scheduleHandHoverClear();
              sceneRef.current?.releaseHandHover();
            }}
          />
          <div
            style={{
              position: "absolute",
              left: Math.min(
                handHover.bounds.x + handHover.bounds.width + HAND_ACTIONS_GAP_PX,
                Math.max(
                  0,
                  (canvasRef.current?.clientWidth ?? Infinity) - HAND_ACTIONS_PANEL_W - 8,
                ),
              ),
              top: handHover.bounds.y,
              zIndex: Z_HAND_ACTIONS_MENU,
            }}
            onMouseEnter={() => {
              cancelHandHoverClear();
              sceneRef.current?.holdHandHover();
            }}
            onMouseLeave={() => {
              scheduleHandHoverClear();
              sceneRef.current?.releaseHandHover();
            }}
          >
            <HandCardActions
              actions={handActions}
              onSelectAction={(action) => {
                cancelHandHoverClear();
                sceneRef.current?.releaseHandHover();
                setHandHover(null);
                onSelectHandAction?.(handHover.card, action);
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}
