import { useEffect, useRef } from "react";
import { Application } from "pixi.js";
import { destroyPixiApp, installPixiPatches } from "./pixiPatches";

installPixiPatches();

import { ArrowLayer } from "./ArrowLayer";
import { PointerLayer } from "./PointerLayer";
import { getTheme } from "@/hooks/useTheme";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { registerPixiApp } from "./visibility";
import { PIXI_MAX_FPS } from "./constants";
import type { BoardScene } from "./board/BoardScene";

interface BoardArrowsCanvasProps {
  sceneRef: React.MutableRefObject<BoardScene | null>;
  className?: string;
  suppressPointers?: boolean;
  suppressNonCastingArrows?: boolean;
}

/**
 * Transparent overlay canvas that draws the unified board's arrows ABOVE the
 * React panels (own Pixi app, `pointer-events: none`). Each tick it pulls
 * resolved `ArrowDef`s from the live `BoardScene` (whose own canvas sits
 * below the panels), so arrows are never occluded by avatars / zone tiles.
 */
export function BoardArrowsCanvas({
  sceneRef,
  className,
  suppressPointers = false,
  suppressNonCastingArrows = false,
}: BoardArrowsCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<Application | null>(null);
  const arrowLayerRef = useRef<ArrowLayer | null>(null);
  const pointerLayerRef = useRef<PointerLayer | null>(null);
  const unregisterRef = useRef<(() => void) | null>(null);
  const sceneRefRef = useRef(sceneRef);
  const suppressPointersRef = useRef(suppressPointers);
  const suppressNonCastingArrowsRef = useRef(suppressNonCastingArrows);

  useEffect(() => {
    sceneRefRef.current = sceneRef;
  }, [sceneRef]);
  useEffect(() => {
    suppressPointersRef.current = suppressPointers;
  }, [suppressPointers]);
  useEffect(() => {
    suppressNonCastingArrowsRef.current = suppressNonCastingArrows;
  }, [suppressNonCastingArrows]);

  useEffect(() => {
    let active = true;
    const app = new Application();
    appRef.current = app;
    app
      .init({
        canvas: canvasRef.current!,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.max(2, window.devicePixelRatio || 1),
      })
      .then(() => {
        if (!active || !app.renderer) {
          destroyPixiApp(app);
          return;
        }
        app.ticker.maxFPS = PIXI_MAX_FPS;
        unregisterRef.current = registerPixiApp(app);
        const theme = getTheme();
        const arrowLayer = new ArrowLayer();
        arrowLayer.setTheme(theme);
        app.stage.addChild(arrowLayer.graphics);
        arrowLayerRef.current = arrowLayer;
        const pointerLayer = new PointerLayer();
        pointerLayer.setTheme(theme);
        app.stage.addChild(pointerLayer.graphics);
        pointerLayerRef.current = pointerLayer;
        pointerLayer.loadAssets().catch((err) => {
          console.error("[board-arrows] pointer asset load failed:", err);
        });
        const parent = canvasRef.current?.parentElement;
        if (parent) app.renderer.resize(parent.clientWidth, parent.clientHeight);
        app.ticker.add(() => {
          const scene = sceneRefRef.current.current;
          const allArrows = scene?.getArrowDefs() ?? [];
          const arrows = suppressNonCastingArrowsRef.current
            ? allArrows.filter((arrow) => arrow.type === "casting")
            : allArrows;
          const pointers = suppressPointersRef.current ? [] : (scene?.getPointerDefs() ?? []);
          arrowLayer.update(arrows, app.ticker.deltaMS);
          pointerLayer.update(pointers, app.ticker.deltaMS);
        });
      });
    return () => {
      active = false;
      unregisterRef.current?.();
      unregisterRef.current = null;
      arrowLayerRef.current?.destroy();
      arrowLayerRef.current = null;
      pointerLayerRef.current?.destroy();
      pointerLayerRef.current = null;
      destroyPixiApp(appRef.current);
      appRef.current = null;
    };
  }, []);

  useEffect(() => {
    const parent = canvasRef.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) appRef.current?.renderer?.resize(width, height);
      }
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () =>
      usePreferencesStore.subscribe(() => {
        const theme = getTheme();
        arrowLayerRef.current?.setTheme(theme);
        pointerLayerRef.current?.setTheme(theme);
      }),
    [],
  );

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: "100%", height: "100%", display: "block", pointerEvents: "none" }}
    />
  );
}
