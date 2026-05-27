import { useRef, useEffect, useCallback, useState } from "react";
import { Application } from "pixi.js";
import { destroyPixiApp, installPixiPatches } from "./pixiPatches";
import { PixiGameScene, type PixiSceneOptions } from "./PixiGameScene";

// Runtime workarounds for Pixi v8 bugs — must run before any `Application`
// is constructed.
installPixiPatches();
import { setPixiTextStyleTheme } from "./textStyles";
import { getTheme } from "@/hooks/useTheme";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import type {
  GameCanvasCallbacks,
  BattlefieldState,
  HandState,
  ScreenBounds,
  PlayZoneRect,
} from "./types";
import { useHandScale } from "@/hooks/useHandScale";
import { HandCardActions } from "@/components/game/zones/HandCardActions";
import type { HandActionOption } from "@/stores/useGameUIStore";
import type { GameCard } from "@/types/manabrew";
import { useGameDevStore } from "@/stores/useGameDevStore";
import {
  FPS_SAMPLE_INTERVAL_MS,
  HAND_ACTIONS_CLEAR_DELAY_MS,
  HAND_ACTIONS_GAP_PX,
  PIXI_MAX_FPS,
  Z_HAND_ACTIONS_MENU,
} from "./constants";
import { registerPixiApp } from "./visibility";

interface PixiGameCanvasProps {
  battlefield: BattlefieldState;
  hand?: HandState;
  /**
   * Optional out-ref that's populated with the live `PixiGameScene` so a
   * sibling component (e.g. the full-board arrows overlay canvas) can read
   * sprite positions for arrow resolution.
   */
  sceneRef?: React.MutableRefObject<PixiGameScene | null>;
  /**
   * Sub-rectangle of the canvas where battlefield sprites + hand should
   * render. When omitted the full canvas is used. Pass the "my half"
   * bounding rect (relative to the canvas) to keep gameplay inside that
   * area while the canvas itself spans the entire game board.
   */
  playZone?: PlayZoneRect | null;
  placementGhostName?: string | null;
  isDropActive?: boolean;
  callbacks: GameCanvasCallbacks;
  bottomReserved?: number;
  leftReserved?: number;
  /** Keep-out box at the top-left for the opponent panel cluster. */
  topLeftReserved?: { width: number; height: number } | null;
  /** Auto-fit the card scale so at least this many rows always render. */
  minRows?: number;
  /** Keep-out size anchored to the bottom-left of the canvas — the player
   *  panel cluster (avatar + zones + mana). */
  bottomLeftReserved?: { width: number; height: number } | null;
  /** Keep-out rects in canvas-local coords (e.g. dynamic UI overlays). */
  externalBlockers?: ScreenBounds[];
  /**
   * Fixed-size keep-out anchored to the canvas bottom-right corner. Used for
   * the PASS / phase-pass button cluster so lands aren't placed under it.
   */
  bottomRightReserved?: { width: number; height: number } | null;
  className?: string;
  getHandActions?: (card: GameCard) => HandActionOption[];
  onSelectHandAction?: (card: GameCard, action: HandActionOption) => void;
  /**
   * Construction-time feature flags — `mirrored`, `showHand`, `allowDrag`.
   * The scene reads them once in its constructor, so remounting the
   * canvas is required if the caller ever needs to flip them (nothing in
   * the app does so today).
   */
  sceneOptions?: PixiSceneOptions;
}

interface HandHoverState {
  card: GameCard;
  bounds: ScreenBounds;
}

export function PixiGameCanvas({
  battlefield,
  hand,
  playZone,
  sceneRef: externalSceneRef,
  placementGhostName,
  isDropActive,
  callbacks,
  bottomReserved = 0,
  leftReserved = 0,
  topLeftReserved,
  minRows,
  bottomLeftReserved,
  externalBlockers,
  bottomRightReserved,
  className,
  getHandActions,
  onSelectHandAction,
  sceneOptions,
}: PixiGameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<Application | null>(null);
  const unregisterVisibilityRef = useRef<(() => void) | null>(null);
  const [scene, setScene] = useState<PixiGameScene | null>(null);
  const sceneRef = useRef<PixiGameScene | null>(null);
  const callbacksRef = useRef(callbacks);
  // Scene construction options are read once when the scene is built.
  // Store them in a ref so the init callback's dependency list stays
  // stable (the `initApp` useCallback would otherwise rebuild the scene
  // whenever the caller re-renders with a new object literal).
  const sceneOptionsRef = useRef(sceneOptions);
  const [handHover, setHandHover] = useState<HandHoverState | null>(null);
  const clearTimerRef = useRef<number | null>(null);

  // Keep sceneRef in sync with scene state so cleanup closures always see
  // the current instance without forcing effect re-runs.
  useEffect(() => {
    sceneRef.current = scene;
    if (externalSceneRef) externalSceneRef.current = scene;
  }, [scene, externalSceneRef]);

  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

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
        // Force a generous minimum so text (PT, badges, counters, keyword
        // chips) stays sharp at the hand's effective scale. Hand sprites
        // render at ~1.8x base and ~3.25x when hovered (medium / large can
        // go up to ~4.3x), so a 3x backing buffer keeps text crisp across
        // the full range even on non-retina displays. On retina we inherit
        // devicePixelRatio (typically 2 or 3).
        resolution: Math.max(3, window.devicePixelRatio || 1),
      });
    } catch (err) {
      console.error("[pixi] Failed to initialize application:", err);
      appRef.current = null;
      return;
    }

    if (!app.renderer) {
      appRef.current = null;
      return;
    }

    app.ticker.maxFPS = PIXI_MAX_FPS;
    unregisterVisibilityRef.current = registerPixiApp(app);

    const newScene = new PixiGameScene(
      app,
      {
        // scene callbacks follow — the construction-time options are the
        // third argument below.
        onClickCard: (...args) => callbacksRef.current.onClickCard?.(...args),
        onHoverCard: (...args) => callbacksRef.current.onHoverCard?.(...args),
        onClickAnyCard: (...args) => callbacksRef.current.onClickAnyCard?.(...args),
        onFlipCard: () => callbacksRef.current.onFlipCard?.(),
        onTapLand: (...args) => callbacksRef.current.onTapLand?.(...args),
        onTapLands: (...args) => callbacksRef.current.onTapLands?.(...args),
        onUntapLand: (...args) => callbacksRef.current.onUntapLand?.(...args),
        onUntapLands: (...args) => callbacksRef.current.onUntapLands?.(...args),
        onTapLandAbility: (...args) => callbacksRef.current.onTapLandAbility?.(...args),
        onAttackerClick: (...args) => callbacksRef.current.onAttackerClick?.(...args),
        onTargetPlayer: (...args) => callbacksRef.current.onTargetPlayer?.(...args),
        onStartDrag: (...args) => callbacksRef.current.onStartDrag?.(...args),
        onClickCard_Hand: (...args) => callbacksRef.current.onClickCard_Hand?.(...args),
        onCastSpell: (...args) => callbacksRef.current.onCastSpell?.(...args),
        onDismissHoverPreview: () => callbacksRef.current.onDismissHoverPreview?.(),
        onHoverHandCard: (card, bounds) => {
          if (card && bounds) {
            cancelHandHoverClear();
            setHandHover({ card, bounds });
          } else {
            scheduleHandHoverClear();
          }
        },
      },
      sceneOptionsRef.current,
    );

    const themeColors = getTheme();
    setPixiTextStyleTheme(themeColors);
    newScene.setTheme(themeColors);

    const parent = canvasRef.current.parentElement;
    if (parent) {
      newScene.resize(parent.clientWidth, parent.clientHeight);
    }

    setScene(newScene);
  }, [cancelHandHoverClear, scheduleHandHoverClear]);

  useEffect(() => {
    let active = true;
    initApp().then(() => {
      // Effect was cleaned up while init was in flight — tear down the
      // app/scene we just created instead of leaking the WebGL context.
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
      cancelHandHoverClear();
      sceneRef.current?.destroy();
      sceneRef.current = null;
      unregisterVisibilityRef.current?.();
      unregisterVisibilityRef.current = null;
      destroyPixiApp(appRef.current);
      appRef.current = null;
      setScene(null);
    };
  }, [initApp, cancelHandHoverClear]);

  useEffect(() => {
    const parent = canvasRef.current?.parentElement;
    if (!parent || !scene) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        scene.resize(width, height);
      }
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, [scene]);

  useEffect(() => {
    if (!scene) return;
    const unsub = usePreferencesStore.subscribe(() => {
      const themeColors = getTheme();
      setPixiTextStyleTheme(themeColors);
      scene.setTheme(themeColors);
    });
    return unsub;
  }, [scene]);

  const handSize = usePreferencesStore((s) => s.handSize);
  const battlefieldCardScale = usePreferencesStore((s) => s.battlefieldCardScale);
  const vScale = useHandScale();

  useEffect(() => {
    if (!scene) return;
    scene.setBattlefieldCardScale(battlefieldCardScale);
  }, [scene, battlefieldCardScale]);

  useEffect(() => {
    if (!scene) return;
    scene.setReserved(bottomReserved, leftReserved);
    scene.setBottomLeftReserved(bottomLeftReserved ?? null);
    scene.setTopLeftReserved(topLeftReserved ?? null);
    scene.setMinRows(minRows ?? null);
    scene.updateBattlefield(battlefield);
  }, [
    scene,
    battlefield,
    bottomReserved,
    leftReserved,
    topLeftReserved,
    minRows,
    bottomLeftReserved,
  ]);

  useEffect(() => {
    if (!scene) return;
    scene.setHandPreferences(handSize, vScale);
    scene.updateHand(hand ?? { cards: [] });
    // Hand dimensions changed → blocker rect changed → re-layout battlefield
    scene.updateBattlefield(battlefield);
  }, [scene, hand, handSize, vScale, battlefield]);

  useEffect(() => {
    if (!scene) return;
    scene.setPlayZone(playZone ?? null);
  }, [scene, playZone]);

  useEffect(() => {
    if (!scene) return;
    scene.showPlacementGhost(placementGhostName ?? null);
  }, [scene, placementGhostName]);

  useEffect(() => {
    if (!scene) return;
    scene.setDropActive(isDropActive ?? false);
  }, [scene, isDropActive]);

  useEffect(() => {
    if (!scene) return;
    scene.setExternalBlockers(externalBlockers ?? []);
  }, [scene, externalBlockers]);

  useEffect(() => {
    if (!scene) return;
    scene.setBottomRightReserved(bottomRightReserved ?? null);
  }, [scene, bottomRightReserved]);

  // Sample Pixi ticker FPS and push to the dev store for the FPS counter.
  useEffect(() => {
    if (!scene) return;
    const app = scene.app;
    const setPixiPerfStats = useGameDevStore.getState().setPixiPerfStats;
    let frames = 0;
    let totalDelta = 0;
    let minFps = Infinity;
    let maxFps = 0;
    let lastFlush = performance.now();

    const sample = () => {
      if (scene.isDestroyed) return;
      const instantFps = app.ticker.FPS;
      frames += 1;
      totalDelta += app.ticker.deltaMS;
      if (instantFps < minFps) minFps = instantFps;
      if (instantFps > maxFps) maxFps = instantFps;

      const now = performance.now();
      if (now - lastFlush >= FPS_SAMPLE_INTERVAL_MS) {
        setPixiPerfStats({
          fps: frames / ((now - lastFlush) / 1000),
          minFps: minFps === Infinity ? 0 : minFps,
          maxFps,
          deltaMs: totalDelta / Math.max(1, frames),
        });
        frames = 0;
        totalDelta = 0;
        minFps = Infinity;
        maxFps = 0;
        lastFlush = now;
      }
    };

    app.ticker.add(sample);
    return () => {
      // The Pixi app may already have been destroyed by the time this
      // cleanup fires (e.g. on game-over → unmount). Guard defensively.
      if (!scene.isDestroyed && app.ticker) {
        try {
          app.ticker.remove(sample);
        } catch {
          /* ticker gone */
        }
      }
      setPixiPerfStats(null);
    };
  }, [scene]);

  const handActions = handHover && getHandActions ? getHandActions(handHover.card) : [];
  const showActionPanel = handHover && handActions.length > 0 && !!onSelectHandAction;

  return (
    <div className={className} style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      {showActionPanel && (
        <div
          style={{
            position: "absolute",
            left: handHover.bounds.x + handHover.bounds.width + HAND_ACTIONS_GAP_PX,
            top: handHover.bounds.y,
            zIndex: Z_HAND_ACTIONS_MENU,
          }}
          onMouseEnter={() => {
            cancelHandHoverClear();
            scene?.holdHandHover();
          }}
          onMouseLeave={() => {
            scheduleHandHoverClear();
            scene?.releaseHandHover();
          }}
        >
          <HandCardActions
            actions={handActions}
            onSelectAction={(action) => {
              cancelHandHoverClear();
              scene?.releaseHandHover();
              setHandHover(null);
              onSelectHandAction?.(handHover.card, action);
            }}
          />
        </div>
      )}
    </div>
  );
}
