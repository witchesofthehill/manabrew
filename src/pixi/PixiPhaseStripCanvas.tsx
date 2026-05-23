/**
 * Standalone Pixi canvas for the horizontal phase strip.
 * Intended to be positioned at the border between opponent and player halves.
 */

import { useRef, useEffect, useEffectEvent, useCallback, useState } from "react";
import { Application } from "pixi.js";
import { destroyPixiApp, installPixiPatches } from "./pixiPatches";
import { PIXI_MAX_FPS } from "./constants";
import { registerPixiApp } from "./visibility";
installPixiPatches();
import { PhaseStripLayer, type PhaseStripState, type PhaseStripCallbacks } from "./PhaseStripLayer";
import { getTheme } from "@/hooks/useTheme";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

interface Props {
  state: PhaseStripState;
  callbacks: PhaseStripCallbacks;
  className?: string;
}

export function PixiPhaseStripCanvas({ state, callbacks, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<Application | null>(null);
  const stripRef = useRef<PhaseStripLayer | null>(null);
  const unregisterVisibilityRef = useRef<(() => void) | null>(null);

  const [ready, setReady] = useState(false);

  // Re-bind PhaseStripLayer callbacks whenever the parent's callbacks change.
  useEffect(() => {
    stripRef.current?.setCallbacks({
      onToggleSelfPhase: (id) => callbacks.onToggleSelfPhase?.(id),
      onToggleOpponentPhase: (oppId, id) => callbacks.onToggleOpponentPhase?.(oppId, id),
    });
  }, [callbacks, ready]);

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
        resolution: Math.max(2, window.devicePixelRatio || 1),
      });
    } catch {
      appRef.current = null;
      return false;
    }
    if (!app.renderer) {
      appRef.current = null;
      return false;
    }

    app.ticker.maxFPS = PIXI_MAX_FPS;
    unregisterVisibilityRef.current = registerPixiApp(app);

    const theme = getTheme();
    const strip = new PhaseStripLayer(theme);
    stripRef.current = strip;
    app.stage.addChild(strip.container);

    const parent = canvasRef.current.parentElement;
    if (parent && app.renderer) {
      app.renderer.resize(parent.clientWidth, parent.clientHeight);
      strip.resize(parent.clientWidth, parent.clientHeight);
    }

    app.ticker.add(() => strip.tick());
    return true;
  }, []);

  const markReady = useEffectEvent((value: boolean) => setReady(value));

  useEffect(() => {
    let active = true;
    initApp().then((success) => {
      // Effect was cleaned up while init was in flight — tear down the
      // app we just created instead of leaking its WebGL context.
      if (!active) {
        destroyPixiApp(appRef.current);
        appRef.current = null;
        return;
      }
      if (success) markReady(true);
    });
    return () => {
      active = false;
      stripRef.current?.destroy();
      stripRef.current = null;
      unregisterVisibilityRef.current?.();
      unregisterVisibilityRef.current = null;
      destroyPixiApp(appRef.current);
      appRef.current = null;
      markReady(false);
    };
  }, [initApp]);

  // Resize
  useEffect(() => {
    const parent = canvasRef.current?.parentElement;
    const app = appRef.current;
    const strip = stripRef.current;
    if (!parent || !app || !strip) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        // App may have been destroyed between the resize event firing
        // and this callback running (HMR re-mounts, unmount during init).
        if (width > 0 && height > 0 && app.renderer) {
          app.renderer.resize(width, height);
          strip.resize(width, height);
        }
      }
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, [ready]);

  // Theme
  useEffect(() => {
    if (!stripRef.current) return;
    const unsub = usePreferencesStore.subscribe(() => {
      const theme = getTheme();
      stripRef.current?.setTheme(theme);
    });
    return unsub;
  }, [ready]);

  // State
  useEffect(() => {
    stripRef.current?.update(state);
  }, [state, ready]);

  return (
    <div className={className} style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}
