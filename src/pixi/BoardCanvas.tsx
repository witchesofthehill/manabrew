import { useRef, useEffect, useCallback, useState } from "react";
import { Application } from "pixi.js";
import { destroyPixiApp, installPixiPatches } from "./pixiPatches";

// Runtime workarounds for Pixi v8 bugs — must run before any `Application`.
installPixiPatches();

import { BoardScene, type BoardPlayerSpec } from "./board/BoardScene";
import {
  computeBoardLayout,
  type BoardArrangement,
  type RegionOrientation,
} from "./board/boardLayout";
import { battlefieldScaleForFraction } from "./GridLayout";
import { setPixiTextStyleTheme } from "./textStyles";
import { getTheme } from "@/hooks/useTheme";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { registerPixiApp } from "./visibility";
import {
  HAND_ACTIONS_CLEAR_DELAY_MS,
  HAND_ACTIONS_GAP_PX,
  MAX_CANVAS_RESOLUTION,
  PIXI_MAX_FPS,
  Z_HAND_ACTIONS_MENU,
} from "./constants";
import { HandCardActions } from "@/components/game/zones/HandCardActions";
import { useCardFaces } from "@/hooks/useCardFaces";
import { useKeybindings } from "@/hooks/useKeybindings";
import { useGameDevStore } from "@/stores/useGameDevStore";
import { setAnimationsEnabled } from "./effects/enabled";
import { withAlpha } from "@/themes/gameTheme";
import { RotateCw } from "lucide-react";

/** Matches HandCardActions `w-[220px]`. */
const HAND_ACTIONS_PANEL_W = 220;
import type { HandActionOption } from "@/stores/useGameUIStore";
import type { GameCard } from "@/types/manabrew";
import type {
  ArrowSpec,
  BattlefieldState,
  GameCanvasCallbacks,
  HandState,
  PlayZoneRect,
  ScreenBounds,
} from "./types";
import type { PhaseStripCallbacks, PhaseStripState } from "./PhaseStripLayer";
import type { BlockingRect } from "./board/types";

export interface BoardCanvasRegion {
  playerId: string;
  isLocal: boolean;
  state: BattlefieldState;
}

/** Canvas-local px == CSS px, so the parent can anchor React panels to each
 *  player's region. */
export interface BoardCanvasLayout {
  self: PlayZoneRect | null;
  /** Y of the center band where the phase strip is centered. */
  dividerY: number;
  opponents: { playerId: string; rect: PlayZoneRect; orientation: RegionOrientation }[];
}

interface BoardCanvasProps {
  regions: BoardCanvasRegion[];
  hand: HandState;
  arrowSpecs: ArrowSpec[];
  castingArrow?: { sourceCardId: string; hostile: boolean } | null;
  /** Local player is declaring blockers — enables drag-to-block. */
  declareBlockers?: boolean;
  combatBlocks?: { blockerId: string; attackerId: string }[];
  phaseStrip: PhaseStripState;
  phaseStripCallbacks?: PhaseStripCallbacks;
  arrangement: BoardArrangement;
  /** Fraction of usable height for the local player's bottom region; defaults to
   *  the layout's built-in fraction when omitted. */
  selfHeightFraction?: number;
  /** Per-opponent column width fractions; equal split when omitted. */
  opponentFractions?: number[];
  /** Px the hand fan reserves at the bottom of the self region — subtracted from
   *  its height when sizing cards so ~3 rows always fit the free area. */
  selfBottomReserve?: number;
  callbacks: GameCanvasCallbacks;
  externalBlockers?: BlockingRect[];
  /** Bottom-corner keep-out widths for the hand fan so it centers in the gap. */
  handInsets?: { left: number; right: number };
  isDropActive?: boolean;
  /** Auto-arrange the battlefield into rows, ignoring manual drag placement. */
  autoSort?: boolean;
  sceneRef?: React.MutableRefObject<BoardScene | null>;
  getHandActions?: (card: GameCard) => HandActionOption[];
  onSelectHandAction?: (card: GameCard, action: HandActionOption) => void;
  onLayout?: (layout: BoardCanvasLayout) => void;
  className?: string;
}

interface HandHoverState {
  card: GameCard;
  bounds: ScreenBounds;
}

export function BoardCanvas({
  regions,
  hand,
  arrowSpecs,
  castingArrow,
  declareBlockers,
  combatBlocks,
  phaseStrip,
  phaseStripCallbacks,
  arrangement,
  selfHeightFraction,
  opponentFractions,
  selfBottomReserve,
  callbacks,
  externalBlockers,
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

  const fraction = usePreferencesStore((s) => s.battlefieldCardScale);
  const cardStyle = usePreferencesStore((s) => s.battlefieldCardStyle);

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
        resolution: Math.min(MAX_CANVAS_RESOLUTION, window.devicePixelRatio || 1),
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
      onTargetPlayer: (...a) => callbacksRef.current.onTargetPlayer?.(...a),
      onStartDrag: (...a) => callbacksRef.current.onStartDrag?.(...a),
      onClickCard_Hand: (...a) => callbacksRef.current.onClickCard_Hand?.(...a),
      onCastSpell: (...a) => callbacksRef.current.onCastSpell?.(...a),
      onDismissHoverPreview: () => callbacksRef.current.onDismissHoverPreview?.(),
      onHoverHandCard: (card, bounds) => {
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
  }));
  const playersKey = players.map((p) => `${p.playerId}:${p.isLocal ? 1 : 0}`).join(",");
  const opponentIds = regions.filter((r) => !r.isLocal).map((r) => r.playerId);
  // Stable content key so `reconfigure`'s identity doesn't churn when the parent
  // re-creates this array prop.
  const opponentFractionsKey = (opponentFractions ?? []).join(",");

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
      arrangement,
      selfHeightFraction,
      opponentFractions,
    );
    // Subtract the hand-fan reserve before picking the scale so ~3 rows stay
    // visible in every region.
    const selfUsable = Math.max(1, layout.self.height - (selfBottomReserve ?? 0));
    const minHeight = Math.min(selfUsable, ...layout.opponents.map((o) => o.rect.height));
    const cardScale = battlefieldScaleForFraction(minHeight, fraction);
    s.configure(players, layout, cardScale);
    onLayoutRef.current?.({
      self: layout.self,
      dividerY: layout.dividerY,
      opponents: opponentIds.map((id, i) => ({
        playerId: id,
        rect: layout.opponents[i]?.rect ?? layout.self,
        orientation: layout.opponents[i]?.orientation ?? "top",
      })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    playersKey,
    arrangement,
    fraction,
    selfHeightFraction,
    opponentFractionsKey,
    selfBottomReserve,
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
  }, [scene, regions]);

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
    scene?.applyCombatBlocks(combatBlocks ?? []);
  }, [scene, combatBlocks, regions]);

  useEffect(() => {
    scene?.setPhaseStripState(phaseStrip);
  }, [scene, phaseStrip]);

  useEffect(() => {
    if (phaseStripCallbacks) scene?.setPhaseStripCallbacks(phaseStripCallbacks);
  }, [scene, phaseStripCallbacks]);

  useEffect(() => {
    scene?.setExternalBlockers(externalBlockers ?? []);
  }, [scene, externalBlockers]);

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
    if (!scene) return;
    return usePreferencesStore.subscribe(() => {
      const theme = getTheme();
      setPixiTextStyleTheme(theme);
      scene.setTheme(theme);
    });
  }, [scene]);

  const handActions = handHover && getHandActions ? getHandActions(handHover.card) : [];
  const showActionPanel = handHover && handActions.length > 0 && !!onSelectHandAction;

  const hoverFaces = useCardFaces({
    name: handHover?.card.name,
    setCode: handHover?.card.setCode,
    cardNumber: handHover?.card.cardNumber,
  });
  const [handFlipBack, setHandFlipBack] = useState(false);
  const hoverCardId = handHover?.card.id ?? null;
  useEffect(() => {
    setHandFlipBack(false);
  }, [hoverCardId]);
  const showHandFlip = !!handHover && hoverFaces.isFlippable;
  const showHoverAreas = useGameDevStore((s) => s.showHoverAreas);

  useEffect(() => {
    scene?.setHoverDebug(showHoverAreas);
  }, [scene, showHoverAreas]);

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

  useKeybindings({
    "flip-card": () => {
      if (showHandFlip) toggleHandFlip();
    },
  });

  return (
    <div className={className} style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
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
            className="pointer-events-auto inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white shadow hover:bg-black/85"
            title="Flip card to view the other face"
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
            {handFlipBack ? "Front" : "Back"}
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
              left: handHover.bounds.x + handHover.bounds.width + HAND_ACTIONS_GAP_PX,
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
