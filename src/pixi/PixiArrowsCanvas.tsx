import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { Application, type Ticker } from "pixi.js";
import { destroyPixiApp, installPixiPatches } from "./pixiPatches";
import { ArrowLayer, type ArrowDef } from "./ArrowLayer";
import { PointerLayer, type ResolvedPointer } from "./PointerLayer";
import { PIXI_MAX_FPS } from "./constants";
import { registerPixiApp } from "./visibility";

installPixiPatches();
import type { Theme } from "@/hooks/useTheme";
import { getTheme } from "@/hooks/useTheme";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { intentPrefersArrow, TargetingIntent } from "@/types/promptType";
import type { ArrowSpec, ArrowEndpoint, CastingArrowSpec, PointerSpec, ScreenPos } from "./types";
import type { PixiGameScene } from "./PixiGameScene";

interface PixiArrowsCanvasProps {
  arrowSpecs?: ArrowSpec[];
  pointerSpecs?: PointerSpec[];
  castingArrow?: CastingArrowSpec | null;
  /** Ref to the main `PixiGameScene` (the player's own canvas). Drives
   *  the placement-ghost lookup and is the first scene searched for
   *  card endpoints. */
  mainSceneRef: React.MutableRefObject<PixiGameScene | null>;
  /** Per-opponent scene refs keyed by player id. The arrow layer
   *  iterates these after the main scene so opponent permanents
   *  resolve to live sprite positions instead of falling back to DOM
   *  queries. Consumed as a live Map so newly-mounted opponents are
   *  picked up without re-subscribing. */
  opponentSceneRefs?: Map<string, React.MutableRefObject<PixiGameScene | null>>;
  className?: string;
}

/**
 * Transparent full-area Pixi canvas that draws *only* arrows.
 *
 * Sits on top of the React DOM and the main game canvas, with
 * `pointer-events: none`, so arrows can span the entire board (opponent
 * side, middle, my side). Endpoints resolve against:
 *   – the main scene's sprite maps (battlefield + hand) when available,
 *   – DOM query (`data-card-id`, `data-player-id`, `data-stack-object-id`)
 *     with viewport→canvas-local translation, otherwise,
 *   – `window.mousemove` for the free end of the casting arrow.
 *
 * Decoupling from the main canvas keeps event handling unchanged in the
 * play area and lets arrows reach React-rendered opponent permanents.
 */
export function PixiArrowsCanvas({
  arrowSpecs,
  pointerSpecs,
  castingArrow,
  mainSceneRef,
  opponentSceneRefs,
  className,
}: PixiArrowsCanvasProps) {
  // Keep a stable ref to the opponent scenes Map so the ticker closure
  // reads the latest live scenes without re-registering on every render.
  const opponentSceneRefsRef = useRef(opponentSceneRefs);
  useEffect(() => {
    opponentSceneRefsRef.current = opponentSceneRefs;
  }, [opponentSceneRefs]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<Application | null>(null);
  const arrowLayerRef = useRef<ArrowLayer | null>(null);
  const pointerLayerRef = useRef<PointerLayer | null>(null);
  const themeRef = useRef<Theme | null>(null);
  const unregisterVisibilityRef = useRef<(() => void) | null>(null);

  // Latest inputs accessed inside the ticker callback without re-binding.
  const arrowSpecsRef = useRef<ArrowSpec[]>([]);
  const pointerSpecsRef = useRef<PointerSpec[]>([]);
  const castingArrowRef = useRef<CastingArrowSpec | null>(null);
  // Last-known canvas-local position per endpoint, used as a fallback when
  // the live resolver returns null (one-frame race between a sprite zone
  // change and the next Pixi tick, opponent scene mounting late, DOM node
  // briefly unmounted, etc.). Without this, the entire arrow/pointer is
  // dropped and the user sees nothing — making targeting feel broken.
  const endpointCacheRef = useRef<Map<string, ScreenPos>>(new Map());
  useEffect(() => {
    arrowSpecsRef.current = arrowSpecs ?? [];
  }, [arrowSpecs]);
  useEffect(() => {
    pointerSpecsRef.current = pointerSpecs ?? [];
  }, [pointerSpecs]);
  useEffect(() => {
    castingArrowRef.current = castingArrow ?? null;
  }, [castingArrow]);

  const cursorViewportRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const [ready, setReady] = useState(false);

  const initApp = useCallback(async (): Promise<boolean> => {
    if (!canvasRef.current || appRef.current) return false;

    const app = new Application();
    appRef.current = app;
    try {
      await app.init({
        canvas: canvasRef.current,
        preference: "webgl",
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        // Arrows are thin lines — bump resolution so strokes stay sharp.
        resolution: Math.max(2, window.devicePixelRatio || 1),
      });
    } catch (err) {
      console.error("[pixi-arrows] init failed:", err);
      appRef.current = null;
      return false;
    }
    if (!app.renderer) return false;

    app.ticker.maxFPS = PIXI_MAX_FPS;
    unregisterVisibilityRef.current = registerPixiApp(app);

    const arrowLayer = new ArrowLayer();
    arrowLayerRef.current = arrowLayer;
    app.stage.addChild(arrowLayer.graphics);

    const pointerLayer = new PointerLayer();
    pointerLayerRef.current = pointerLayer;
    app.stage.addChild(pointerLayer.graphics);
    // Fire-and-forget: sprites simply render blank until textures resolve.
    pointerLayer.loadAssets().catch((err) => {
      console.error("[pixi-arrows] pointer asset load failed:", err);
    });

    themeRef.current = getTheme();
    arrowLayer.setTheme(themeRef.current);
    pointerLayer.setTheme(themeRef.current);

    app.ticker.add((ticker: Ticker) => {
      const arrowLayer = arrowLayerRef.current;
      const pointerLayer = pointerLayerRef.current;
      if (!arrowLayer || !canvasRef.current) return;
      const hasInputs =
        arrowSpecsRef.current.length > 0 ||
        pointerSpecsRef.current.length > 0 ||
        castingArrowRef.current !== null;
      if (!hasInputs && arrowLayer.isClear && (!pointerLayer || pointerLayer.isClear)) return;

      const opponentScenes: { playerId: string; scene: PixiGameScene }[] = [];
      const map = opponentSceneRefsRef.current;
      if (map) {
        for (const [playerId, ref] of map.entries()) {
          if (ref.current) opponentScenes.push({ playerId, scene: ref.current });
        }
      }
      const { arrows, pointers } = resolveArrowsAndPointers(
        canvasRef.current,
        arrowSpecsRef.current,
        pointerSpecsRef.current,
        castingArrowRef.current,
        mainSceneRef.current,
        opponentScenes,
        cursorViewportRef.current,
        endpointCacheRef.current,
      );
      arrowLayer.update(arrows, ticker.deltaMS);
      pointerLayer?.update(pointers, ticker.deltaMS);
    });

    // Initial resize since we no longer use resizeTo. Renderer may have
    // been torn down already if the effect cleanup fired between the
    // `await app.init()` resolution and this point.
    const parent = canvasRef.current.parentElement;
    if (parent && app.renderer) {
      app.renderer.resize(parent.clientWidth, parent.clientHeight);
    }

    return true;
  }, [mainSceneRef]);

  const markReady = useEffectEvent((value: boolean) => setReady(value));

  useEffect(() => {
    let active = true;
    initApp().then((success) => {
      if (!active) {
        unregisterVisibilityRef.current?.();
        unregisterVisibilityRef.current = null;
        destroyPixiApp(appRef.current);
        appRef.current = null;
        return;
      }
      if (success) markReady(true);
    });
    return () => {
      active = false;
      arrowLayerRef.current?.destroy();
      arrowLayerRef.current = null;
      pointerLayerRef.current?.destroy();
      pointerLayerRef.current = null;
      unregisterVisibilityRef.current?.();
      unregisterVisibilityRef.current = null;
      destroyPixiApp(appRef.current);
      appRef.current = null;
      markReady(false);
    };
  }, [initApp]);

  // Resize the canvas when the parent element resizes
  useEffect(() => {
    const parent = canvasRef.current?.parentElement;
    const app = appRef.current;
    if (!parent || !app) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        // App may have been destroyed between the resize event firing
        // and this callback running (HMR re-mounts, unmount during init).
        if (width > 0 && height > 0 && app.renderer) {
          app.renderer.resize(width, height);
        }
      }
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, [ready]);

  // Re-apply theme whenever preferences change (same subscription pattern
  // PixiGameCanvas uses for its scene).
  useEffect(() => {
    if (!ready) return;
    const apply = () => {
      themeRef.current = getTheme();
      arrowLayerRef.current?.setTheme(themeRef.current);
      pointerLayerRef.current?.setTheme(themeRef.current);
    };
    apply();
    return usePreferencesStore.subscribe(apply);
  }, [ready]);

  // Track cursor globally so the free casting-arrow endpoint follows the
  // mouse even when it's over DOM elements covering the arrows canvas.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      cursorViewportRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 45,
      }}
    />
  );
}

// ────────────────────────────────────────────────────────────────────────
// Endpoint resolution — pure helpers below
// ────────────────────────────────────────────────────────────────────────

function resolveArrowsAndPointers(
  canvas: HTMLCanvasElement,
  arrowSpecs: ArrowSpec[],
  pointerSpecs: PointerSpec[],
  casting: CastingArrowSpec | null,
  mainScene: PixiGameScene | null,
  opponentScenes: { playerId: string; scene: PixiGameScene }[],
  cursorViewport: { x: number; y: number },
  endpointCache: Map<string, ScreenPos>,
): { arrows: ArrowDef[]; pointers: ResolvedPointer[] } {
  if (arrowSpecs.length === 0 && pointerSpecs.length === 0 && !casting) {
    return { arrows: [], pointers: [] };
  }
  const canvasRect = canvas.getBoundingClientRect();
  const scenesWithRect: Array<{ scene: PixiGameScene; rect: DOMRect }> = [];
  if (mainScene) {
    scenesWithRect.push({
      scene: mainScene,
      rect: mainScene.canvasElement.getBoundingClientRect(),
    });
  }
  for (const { scene } of opponentScenes) {
    scenesWithRect.push({ scene, rect: scene.canvasElement.getBoundingClientRect() });
  }
  // Per-player lookup for placement-ghost resolution. mainScene isn't in
  // here — anything not in this map falls back to mainScene below.
  const opponentSceneByPlayerId = new Map<string, PixiGameScene>();
  for (const { playerId, scene } of opponentScenes) {
    opponentSceneByPlayerId.set(playerId, scene);
  }

  const toLocal = (viewport: { x: number; y: number }): ScreenPos => ({
    x: viewport.x - canvasRect.left,
    y: viewport.y - canvasRect.top,
  });

  const resolveEndpointLive = (ep: ArrowEndpoint): ScreenPos | null => {
    switch (ep.kind) {
      case "card": {
        // Probe each live scene (player first, then opponents) for the
        // sprite before falling through to a DOM query. Each scene
        // reports canvas-local coords that we translate into the
        // arrow-canvas' own viewport.
        for (const { scene, rect } of scenesWithRect) {
          const spr = scene.getCardSpritePosition(ep.id);
          if (spr) {
            return {
              x: spr.x + rect.left - canvasRect.left,
              y: spr.y + rect.top - canvasRect.top,
            };
          }
        }
        return domCenter(`[data-card-id="${CSS.escape(ep.id)}"]`, toLocal);
      }
      case "player":
        return domCenter(`[data-player-id="${CSS.escape(ep.id)}"]`, toLocal);
      case "stack":
        return domCenter(`[data-stack-object-id="${CSS.escape(ep.id)}"]`, toLocal);
      case "placement-ghost": {
        // Resolve to the controller's scene if specified — opponent
        // permanent spells preview into the opponent's battlefield, not
        // ours. Falls back to mainScene when no playerId or when the
        // playerId isn't an opponent (i.e. it's the local player).
        const oppScene = ep.playerId ? opponentSceneByPlayerId.get(ep.playerId) : null;
        const scene = oppScene ?? mainScene;
        if (!scene) return null;
        const sceneEntry = scenesWithRect.find((s) => s.scene === scene);
        if (!sceneEntry) return null;
        const c = scene.getPlacementGhostCenter();
        return {
          x: c.x + sceneEntry.rect.left - canvasRect.left,
          y: c.y + sceneEntry.rect.top - canvasRect.top,
        };
      }
    }
  };

  // Wraps the live resolver with a stable cache so a single missed frame
  // (sprite added but Pixi hasn't ticked yet, opponent scene mounted late,
  // DOM node briefly absent) doesn't drop the entire arrow/pointer.
  // `placement-ghost` is purely positional (next free slot) so we never
  // cache it — a stale slot would mislead the player.
  const resolveEndpoint = (ep: ArrowEndpoint): ScreenPos | null => {
    const live = resolveEndpointLive(ep);
    if (ep.kind === "placement-ghost") return live;
    const key = `${ep.kind}:${ep.id}`;
    if (live) {
      endpointCache.set(key, live);
      return live;
    }
    return endpointCache.get(key) ?? null;
  };

  const arrows: ArrowDef[] = [];
  for (const spec of arrowSpecs) {
    const from = resolveEndpoint(spec.from);
    const to = resolveEndpoint(spec.to);
    if (!from || !to) continue;
    arrows.push({
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
      type: spec.type,
    });
  }

  const pointers: ResolvedPointer[] = [];
  for (const spec of pointerSpecs) {
    const from = resolveEndpoint(spec.from);
    const to = resolveEndpoint(spec.to);
    if (!from || !to) continue;
    pointers.push({
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
      intent: spec.intent,
      locked: true,
    });
  }

  // Casting pointer: cursor-following icon that locks onto the chosen
  // target. Combat-intent casting (shouldn't happen here) would fall back
  // to the arrow layer.
  if (casting) {
    // Try the stack display element first, then fall back to the
    // battlefield card sprite (activated abilities) or DOM card element.
    let from =
      domCenter(`[data-casting-card="${CSS.escape(casting.castingCardId)}"]`, toLocal) ??
      resolveEndpoint({ kind: "card", id: casting.castingCardId });
    let to: ScreenPos | null = null;
    if (casting.targetId) {
      to =
        resolveEndpoint({ kind: "card", id: casting.targetId }) ??
        resolveEndpoint({ kind: "player", id: casting.targetId });
    } else {
      to = toLocal(cursorViewport);
    }
    if (to) {
      const intent =
        casting.intent ?? (casting.hostile ? TargetingIntent.Hostile : TargetingIntent.Friendly);
      if (!from && !intentPrefersArrow(intent)) {
        // Some target-like prompts happen while the source card has no live
        // board/stack/hand anchor (for example an UnlessCost sacrifice during
        // spell resolution). Still draw the cursor glyph; only the source glow
        // loses its real anchor for that frame/state.
        from = to;
      }
      if (from && intentPrefersArrow(intent)) {
        const arrowType =
          intent === TargetingIntent.Attack
            ? "attack"
            : intent === TargetingIntent.Block
              ? "block"
              : "attach";
        arrows.push({
          fromX: from.x,
          fromY: from.y,
          toX: to.x,
          toY: to.y,
          type: arrowType,
        });
      } else if (from) {
        pointers.push({
          fromX: from.x,
          fromY: from.y,
          toX: to.x,
          toY: to.y,
          intent,
          locked: !!casting.targetId,
        });
      }
    }
  }

  return { arrows, pointers };
}

function domCenter(
  selector: string,
  toLocal: (viewport: { x: number; y: number }) => ScreenPos,
): ScreenPos | null {
  // The same element may be rendered in multiple places (e.g. a mobile-only
  // <main class="md:hidden"> and a desktop layout). querySelector returns
  // the first DOM-order match, which may be inside a hidden ancestor and
  // report a 0×0 rect. Walk all matches and pick the first laid-out one.
  const els = document.querySelectorAll(selector);
  for (const el of els) {
    const r = (el as HTMLElement).getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    return toLocal({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }
  return null;
}
