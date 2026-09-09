// @refresh reset

import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import { Application } from "pixi.js";
import { destroyPixiApp, installPixiPatches } from "./pixiPatches";

// Runtime workarounds for Pixi v8 bugs — must run before any `Application`.
installPixiPatches();

import { BoardScene, type BoardPlayerSpec } from "./board/BoardScene";
import { computeBoardLayout, type RegionOrientation } from "./board/boardLayout";
import type { PlayerHudSpec as PlayerBarSpec } from "./hud/playerHud.types";
import type { ZoneTileSpec } from "./board/BoardZoneTiles";
import { battlefieldScaleForMultiplier, scaleForRowsWithCombatRow } from "./GridLayout";
import { setPixiTextStyleTheme } from "./textStyles";
import { getTheme } from "@/hooks/useTheme";
import { useHandScale } from "@/hooks/useHandScale";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useGameStore } from "@/stores/useGameStore";
import { isCoarsePointer } from "@/lib/responsive";
import { registerPixiApp } from "./visibility";
import {
  BATTLEFIELD_MIN_ROWS,
  BATTLEFIELD_MIN_ROWS_LARGEST,
  FIELD_INNER_EDGE_PAD_PX,
  HAND_ACTIONS_CLEAR_DELAY_MS,
  HAND_ACTIONS_GAP_PX,
  PIXI_MAX_FPS,
  Z_HAND_ACTIONS_MENU,
} from "./constants";
import { HandCardActions } from "@/components/game/zones/HandCardActions";
import { useCardFaces } from "@/hooks/useCardFaces";
import { useKeybindings } from "@/hooks/useKeybindings";
import { useGameDevStore } from "@/stores/useGameDevStore";
import { useServerStore } from "@/stores/useServerStore";
import { boardBackgroundUrl } from "@/pixi/board/boardBackgrounds";
import { setAnimationsEnabled } from "./effects/enabled";
import { withAlpha } from "@/themes/gameTheme";

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
  color?: string;
}

/** Canvas-local px == CSS px, so the parent can anchor React panels to each
 *  player's region. */
export interface BoardCanvasLayout {
  self: PlayZoneRect | null;
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
  declareBlockers?: boolean;
  combatBlocks?: { blockerId: string; attackerId: string }[];
  declareAttackers?: boolean;
  /** Legal defenders (player / planeswalker / battle) for the active
   *  `chooseAttackers` prompt, and per-attacker validity. */
  attackTargets?: AttackTargetDto[];
  attackerOptions?: { attackerId: string; validTargetIds: string[] }[];
  phaseStrip: PhaseStripState;
  phaseStripCallbacks?: PhaseStripCallbacks;
  compact?: boolean;
  opponentLayout?: "focused" | "overview";
  focusLocked?: boolean;
  focusedOpponentId?: string | null;
  combatFocusIds?: string[];
  manualFocusId?: string | null;
  playerBars?: PlayerBarSpec[];
  showPlayerBars?: boolean;
  zoneTiles?: Record<string, ZoneTileSpec[]>;
  /** Px the hand fan reserves at the bottom of the self region — subtracted from
   *  its height when sizing cards so ~3 rows always fit the free area. */
  selfBottomReserve?: number;
  callbacks: GameCanvasCallbacks;
  /** Bottom-corner keep-out widths for the hand fan so it centers in the gap. */
  handInsets?: { left: number; right: number };
  isDropActive?: boolean;
  autoSort?: boolean;
  sceneRef?: React.MutableRefObject<BoardScene | null>;
  onSceneChange?: (scene: BoardScene | null) => void;
  getHandActions?: (card: CardDto) => HandActionOption[];
  onSelectHandAction?: (card: CardDto, action: HandActionOption) => void;
  externalPreviewActive?: boolean;
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
  compact,
  opponentLayout = "focused",
  focusLocked = false,
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
  onSceneChange,
  getHandActions,
  onSelectHandAction,
  externalPreviewActive,
  onLayout,
  className,
}: BoardCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<Application | null>(null);
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
  const handViewportScale = useHandScale();
  const promptType = useGameStore((s) => s.currentPrompt?.input.type);
  const cardPromptOpen =
    promptType === "chooseCards" ||
    promptType === "revealCards" ||
    promptType === "reorder" ||
    promptType === "scry";

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
    if (externalSceneRef) externalSceneRef.current = scene;
    onSceneChange?.(scene);
    return () => {
      if (externalSceneRef?.current === scene) externalSceneRef.current = null;
      onSceneChange?.(null);
    };
  }, [scene, externalSceneRef, onSceneChange]);
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);
  useEffect(() => {
    onLayoutRef.current = onLayout;
  }, [onLayout]);
  useEffect(() => {
    selfBottomReserveRef.current = selfBottomReserve ?? 0;
  }, [selfBottomReserve]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let initSettled = false;
    let released = false;
    let localScene: BoardScene | null = null;
    let unregisterVisibility: (() => void) | null = null;
    const app = new Application();
    appRef.current = app;

    const release = () => {
      if (released) return;
      released = true;
      const sceneToRelease = localScene;
      localScene = null;
      sceneToRelease?.destroy();
      if (sceneRef.current === sceneToRelease) sceneRef.current = null;
      unregisterVisibility?.();
      unregisterVisibility = null;
      destroyPixiApp(app);
      if (appRef.current === app) appRef.current = null;
    };

    void (async () => {
      try {
        await app.init({
          canvas,
          preference: "webgl",
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: Math.min(2, window.devicePixelRatio || 1),
        });
        initSettled = true;
        if (disposed || appRef.current !== app) {
          release();
          return;
        }
        if (!app.renderer) {
          release();
          return;
        }

        app.ticker.maxFPS = PIXI_MAX_FPS;
        unregisterVisibility = registerPixiApp(app);

        const newScene = new BoardScene(app, {
          onClickCard: (...a) => callbacksRef.current.onClickCard?.(...a),
          onHoverCard: (...a) => callbacksRef.current.onHoverCard?.(...a),
          onHoverZoneCards: (...a) => callbacksRef.current.onHoverZoneCards?.(...a),
          onRightClickCard: (...a) => callbacksRef.current.onRightClickCard?.(...a),
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
          onLongPressCard: (...a) => callbacksRef.current.onLongPressCard?.(...a),
          onBlockDragChange: (...a) => callbacksRef.current.onBlockDragChange?.(...a),
          onAssignAttacker: (...a) => callbacksRef.current.onAssignAttacker?.(...a),
          onUnassignAttacker: (...a) => callbacksRef.current.onUnassignAttacker?.(...a),
          onAttackDragChange: (...a) => callbacksRef.current.onAttackDragChange?.(...a),
          onTargetPlayer: (...a) => callbacksRef.current.onTargetPlayer?.(...a),
          onShowPlayerSheet: (...a) => callbacksRef.current.onShowPlayerSheet?.(...a),
          onHoverOpponent: (...a) => callbacksRef.current.onHoverOpponent?.(...a),
          onStartDrag: (...a) => callbacksRef.current.onStartDrag?.(...a),
          onReorderHand: (...a) => callbacksRef.current.onReorderHand?.(...a),
          onClickCard_Hand: (...a) => callbacksRef.current.onClickCard_Hand?.(...a),
          onCastSpell: (...a) => callbacksRef.current.onCastSpell?.(...a),
          onDismissHoverPreview: () => callbacksRef.current.onDismissHoverPreview?.(),
          onHoverHandCard: (card, bounds) => {
            callbacksRef.current.onHoverHandCard?.(card, bounds);
            if (card && bounds) {
              cancelHandHoverClear();
              setHandHover({ card, bounds });
            } else {
              cancelHandHoverClear();
              setHandHover(null);
            }
          },
        });
        localScene = newScene;

        const theme = getTheme();
        setPixiTextStyleTheme(theme);
        newScene.setTheme(theme);

        const parent = canvas.parentElement;
        if (parent) newScene.resize(parent.clientWidth, parent.clientHeight);
        newScene.setOnHandReserveChange((px) => {
          reserveRef.current = px;
          const base = latestLayoutRef.current;
          if (!base) return;
          const updated = {
            ...base,
            selfClusterMaxHeight: Math.max(px, selfBottomReserveRef.current),
          };
          latestLayoutRef.current = updated;
          onLayoutRef.current?.(updated);
        });
        sceneRef.current = newScene;
        setScene(newScene);
      } catch (err) {
        initSettled = true;
        release();
        if (!disposed) console.error("[pixi] BoardCanvas init failed:", err);
      }
    })();

    return () => {
      disposed = true;
      if (sceneRef.current === localScene) sceneRef.current = null;
      if (appRef.current === app) appRef.current = null;
      if (initSettled) release();
    };
  }, [cancelHandHoverClear]);

  const players: BoardPlayerSpec[] = regions.map((r) => ({
    playerId: r.playerId,
    isLocal: r.isLocal,
    playmat: r.playmat,
    playmatSettings: r.playmatSettings,
    color: r.color,
  }));
  const playersKey = JSON.stringify(players);
  const opponentIds = regions.filter((r) => !r.isLocal).map((r) => r.playerId);

  const reconfigure = useCallback(() => {
    const app = appRef.current;
    const s = sceneRef.current;
    if (!app?.renderer || !s) return;
    const w = app.renderer.width;
    const h = app.renderer.height;
    const opponentCount = opponentIds.length;
    const layout = computeBoardLayout(
      w,
      h,
      opponentCount,
      selfBottomReserve ?? 0,
      compact ?? false,
      opponentLayout,
    );
    s.setCompactMode(compact ?? false);
    s.setFocusLocked(focusLocked);
    const playmatTrim = (usable: number) => Math.max(1, usable - FIELD_INNER_EDGE_PAD_PX);
    const selfUsable = playmatTrim(Math.max(1, layout.self.height - (selfBottomReserve ?? 0)));
    const selfScale = Math.max(
      Number.EPSILON,
      compact
        ? scaleForRowsWithCombatRow(selfUsable, BATTLEFIELD_MIN_ROWS)
        : Math.min(
            battlefieldScaleForMultiplier(selfUsable, cardSizeMultiplier),
            scaleForRowsWithCombatRow(selfUsable, BATTLEFIELD_MIN_ROWS_LARGEST),
          ),
    );
    const oppUsables = layout.opponents.map((o) => playmatTrim(Math.max(1, o.rect.height)));
    const oppUsable = oppUsables.length ? Math.min(...oppUsables) : selfUsable;
    const oppScale = Math.max(
      Number.EPSILON,
      layout.opponentLayout === "overview"
        ? scaleForRowsWithCombatRow(oppUsable, 1)
        : compact
          ? scaleForRowsWithCombatRow(oppUsable, BATTLEFIELD_MIN_ROWS)
          : Math.min(
              battlefieldScaleForMultiplier(oppUsable, cardSizeMultiplier),
              scaleForRowsWithCombatRow(oppUsable, BATTLEFIELD_MIN_ROWS_LARGEST),
            ),
    );
    s.configure(players, layout, { self: selfScale, opponent: oppScale });
    s.setHandScale(compact ? 1 : handViewportScale);
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
    handViewportScale,
    compact,
    opponentLayout,
    focusLocked,
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
    const liveIds = new Set<string>();
    for (const r of regions) for (const c of r.state.cards) liveIds.add(c.id);
    for (const r of regions) {
      if (!seeding && lastRegionStateRef.current.get(r.playerId) === r.state) continue;
      lastRegionStateRef.current.set(r.playerId, r.state);
      scene.updateRegionState(r.playerId, r.state);
    }
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

  const handActions = useMemo(
    () => (handHover && getHandActions ? getHandActions(handHover.card) : []),
    [getHandActions, handHover],
  );
  const showActionPanel =
    handHover && handActions.length > 0 && !!onSelectHandAction && !isCoarsePointer();

  const hoverFaces = useCardFaces({
    name: handHover?.card.identity.name,
    setCode: handHover?.card.identity.setCode,
    cardNumber: handHover?.card.identity.cardNumber,
  });
  const [handFlipBack, setHandFlipBack] = useState(false);
  const [handRulesView, setHandRulesView] = useState(false);
  const handCardStyle = usePreferencesStore((state) => state.handCardStyle);
  const hoverCardId = handHover?.card.id ?? null;
  useEffect(() => {
    scene?.setHandCardStyle(handCardStyle);
    setHandFlipBack(false);
    setHandRulesView(
      hoverCardId ? (sceneRef.current?.handUsesRulesView(hoverCardId) ?? false) : false,
    );
  }, [handCardStyle, hoverCardId, scene]);
  const showHandFlip = !!handHover && hoverFaces.isFlippable;
  const showHoverAreas = useGameDevStore((s) => s.showHoverAreas);

  useEffect(() => {
    scene?.setHoverDebug(showHoverAreas);
  }, [scene, showHoverAreas]);
  const showPlayerPanelBounds = useGameDevStore((s) => s.showPlayerPanelBounds);

  useEffect(() => {
    scene?.setPlayerPanelBoundsDebug(showPlayerPanelBounds);
  }, [scene, showPlayerPanelBounds]);

  const showGridSkeleton = useGameDevStore((s) => s.showGridSkeleton);

  useEffect(() => {
    scene?.setGridSkeletonDebug(showGridSkeleton);
  }, [scene, showGridSkeleton]);

  const showAttackRows = useGameDevStore((s) => s.showAttackRows);

  useEffect(() => {
    scene?.setAttackRowDebug(showAttackRows);
  }, [scene, showAttackRows]);

  const tableStyle = useServerStore((s) => s.currentRoom?.table_style);

  useEffect(() => {
    scene?.setBackground(boardBackgroundUrl(tableStyle));
  }, [scene, tableStyle]);

  const inGameAnimations = usePreferencesStore((s) => s.inGameAnimations);
  useEffect(() => {
    setAnimationsEnabled(inGameAnimations);
  }, [inGameAnimations]);

  const etbPreviewVersion = useGameDevStore((s) => s.etbGlowVersion);
  useEffect(() => {
    if (etbPreviewVersion > 0) scene?.previewEtb();
  }, [scene, etbPreviewVersion]);

  const toggleHandFlip = useCallback(() => {
    setHandFlipBack((prev) => {
      const next = !prev;
      sceneRef.current?.setHandPreviewFace(next ? 1 : 0);
      return next;
    });
  }, [sceneRef]);
  const toggleHandRulesView = useCallback(() => {
    const active = sceneRef.current?.toggleHoveredHandRulesView();
    if (active != null) setHandRulesView(active);
  }, []);
  const selectHandAction = useCallback(
    (action: HandActionOption) => {
      if (!handHover) return;
      cancelHandHoverClear();
      sceneRef.current?.releaseHandHover();
      setHandHover(null);
      onSelectHandAction?.(handHover.card, action);
    },
    [cancelHandHoverClear, handHover, onSelectHandAction],
  );
  useEffect(() => {
    if (!scene || !handHover) return;
    scene.setHoveredHandControls({
      rulesView: handRulesView,
      horizontal: false,
      alternateFace: handFlipBack,
      showFaceControl: showHandFlip,
      onToggleRules: toggleHandRulesView,
      onToggleFace: toggleHandFlip,
    });
    return () => scene.setHoveredHandControls(null);
  }, [
    handFlipBack,
    handHover,
    handRulesView,
    scene,
    showHandFlip,
    toggleHandFlip,
    toggleHandRulesView,
  ]);

  useEffect(() => {
    if (!scene || !handHover) return;
    scene.setHoveredHandRulesActions(
      handRulesView ? handActions : [],
      handRulesView ? selectHandAction : null,
    );
  }, [handActions, handHover, handRulesView, scene, selectHandAction]);

  useKeybindings({
    ...(!externalPreviewActive && !cardPromptOpen && showHandFlip
      ? { "flip-card": toggleHandFlip }
      : {}),
    ...(!externalPreviewActive && !cardPromptOpen && handHover
      ? { "toggle-card-view": toggleHandRulesView }
      : {}),
  });

  return (
    <div className={className} style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }}
        onContextMenu={(e) => e.preventDefault()}
      />
      {showActionPanel && !handRulesView && (
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
            <HandCardActions actions={handActions} onSelectAction={selectHandAction} />
          </div>
        </>
      )}
    </div>
  );
}
