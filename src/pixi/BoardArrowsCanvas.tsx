import { useEffect, useRef } from "react";
import { Application } from "pixi.js";
import { destroyPixiApp, installPixiPatches } from "./pixiPatches";

installPixiPatches();

import { ArrowLayer } from "./ArrowLayer";
import { getTheme } from "@/hooks/useTheme";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { registerPixiApp } from "./visibility";
import { PIXI_MAX_FPS } from "./constants";
import type { BoardScene } from "./board/BoardScene";

interface BoardArrowsCanvasProps {
  sceneRef: React.MutableRefObject<BoardScene | null>;
  className?: string;
}

/**
 * Transparent overlay canvas that draws the unified board's arrows ABOVE the
 * React panels (own Pixi app, `pointer-events: none`). Each tick it pulls
 * resolved `ArrowDef`s from the live `BoardScene` (whose own canvas sits
 * below the panels), so arrows are never occluded by avatars / zone tiles.
 */
export function BoardArrowsCanvas({ sceneRef, className }: BoardArrowsCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<Application | null>(null);
  const layerRef = useRef<ArrowLayer | null>(null);
  const unregisterRef = useRef<(() => void) | null>(null);
  const sceneRefRef = useRef(sceneRef);

  useEffect(() => {
    sceneRefRef.current = sceneRef;
  }, [sceneRef]);

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
        const layer = new ArrowLayer();
        layer.setTheme(getTheme());
        app.stage.addChild(layer.graphics);
        layerRef.current = layer;
        const parent = canvasRef.current?.parentElement;
        if (parent) app.renderer.resize(parent.clientWidth, parent.clientHeight);
        app.ticker.add(() => {
          const defs = sceneRefRef.current.current?.getArrowDefs() ?? [];
          layer.update(defs, app.ticker.deltaMS);
        });
      });
    return () => {
      active = false;
      unregisterRef.current?.();
      unregisterRef.current = null;
      layerRef.current?.destroy();
      layerRef.current = null;
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

  useEffect(() => usePreferencesStore.subscribe(() => layerRef.current?.setTheme(getTheme())), []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: "100%", height: "100%", display: "block", pointerEvents: "none" }}
    />
  );
}
