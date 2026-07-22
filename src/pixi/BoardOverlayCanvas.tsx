import { useEffect, useRef } from "react";
import { Application } from "pixi.js";
import { destroyPixiApp, installPixiPatches } from "./pixiPatches";

installPixiPatches();

import { ArrowLayer } from "./ArrowLayer";
import { StackLayer } from "./stack/StackLayer";
import type { StackSpec } from "./stack/stack.types";
import { getTheme } from "@/hooks/useTheme";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { isCoarsePointer } from "@/lib/responsive";
import { registerPixiApp } from "./visibility";
import { PIXI_MAX_FPS } from "./constants";
import type { BoardScene } from "./board/BoardScene";

interface BoardOverlayCanvasProps {
  sceneRef: React.MutableRefObject<BoardScene | null>;
  stackSpec: StackSpec;
  onOpenStack: () => void;
  onTargetSpell: (spellId: string) => void;
  onHoverStack: (stackObjectId: string | null) => void;
  onToggleStack: () => void;
  className?: string;
}

export function BoardOverlayCanvas({
  sceneRef,
  stackSpec,
  onOpenStack,
  onTargetSpell,
  onHoverStack,
  onToggleStack,
  className,
}: BoardOverlayCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<Application | null>(null);
  const arrowRef = useRef<ArrowLayer | null>(null);
  const stackRef = useRef<StackLayer | null>(null);
  const unregisterRef = useRef<(() => void) | null>(null);

  const cbRef = useRef({ onOpenStack, onTargetSpell, onHoverStack, onToggleStack });
  useEffect(() => {
    cbRef.current = { onOpenStack, onTargetSpell, onHoverStack, onToggleStack };
  }, [onOpenStack, onTargetSpell, onHoverStack, onToggleStack]);

  useEffect(() => {
    let active = true;
    let registeredScene: BoardScene | null = null;
    const app = new Application();
    appRef.current = app;
    app
      .init({
        canvas: canvasRef.current!,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: isCoarsePointer()
          ? Math.min(2, window.devicePixelRatio || 1)
          : Math.max(2, window.devicePixelRatio || 1),
      })
      .then(() => {
        if (!active || !app.renderer) {
          destroyPixiApp(app);
          return;
        }
        app.ticker.maxFPS = PIXI_MAX_FPS;
        app.stage.eventMode = "static";
        app.stage.sortableChildren = true;
        unregisterRef.current = registerPixiApp(app);

        const arrow = new ArrowLayer();
        arrow.setTheme(getTheme());
        arrow.graphics.eventMode = "none";
        arrowRef.current = arrow;

        const stack = new StackLayer(getTheme(), {
          onOpen: () => cbRef.current.onOpenStack(),
          onTargetSpell: (id) => cbRef.current.onTargetSpell(id),
          onHover: (id) => cbRef.current.onHoverStack(id),
          onToggleCollapsed: () => cbRef.current.onToggleStack(),
        });
        stackRef.current = stack;

        app.stage.addChild(stack.container);
        app.stage.addChild(arrow.graphics);

        const parent = canvasRef.current?.parentElement;
        const w = parent?.clientWidth ?? 0;
        const h = parent?.clientHeight ?? 0;
        if (w > 0 && h > 0) {
          app.renderer.resize(w, h);
          stack.setViewport(w, h);
        }
        app.ticker.add(() => {
          const scene = sceneRef.current;
          if (scene && scene !== registeredScene) {
            registeredScene = scene;
            scene.setStackAnchorProvider(stack);
          }
          const defs = scene?.getArrowDefs() ?? [];
          arrow.update(defs, app.ticker.deltaMS);
        });
      });
    return () => {
      active = false;
      registeredScene?.setStackAnchorProvider(null);
      unregisterRef.current?.();
      unregisterRef.current = null;
      arrowRef.current?.destroy();
      arrowRef.current = null;
      stackRef.current?.destroy();
      stackRef.current = null;
      destroyPixiApp(appRef.current);
      appRef.current = null;
    };
  }, [sceneRef]);

  useEffect(() => {
    stackRef.current?.setSpec(stackSpec);
  }, [stackSpec]);

  useEffect(() => {
    const parent = canvasRef.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          appRef.current?.renderer?.resize(width, height);
          stackRef.current?.setViewport(width, height);
        }
      }
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const insideStack = (clientX: number, clientY: number): boolean => {
      const canvas = canvasRef.current;
      const bounds = stackRef.current?.getBounds();
      if (!canvas || !bounds) return false;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      return (
        x >= bounds.x &&
        x <= bounds.x + bounds.width &&
        y >= bounds.y &&
        y <= bounds.y + bounds.height
      );
    };
    const onMove = (e: PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.style.pointerEvents = insideStack(e.clientX, e.clientY) ? "auto" : "none";
    };
    // Touch taps arrive with no preceding pointermove, so the hover tracking
    // above never enables the canvas for them. Intercept the touch at the
    // window capture phase and replay it onto the canvas so Pixi sees a full
    // down/up pair (the board underneath must not also react — stop the
    // original).
    const clonePointerEvent = (type: string, e: PointerEvent) =>
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        isPrimary: e.isPrimary,
        clientX: e.clientX,
        clientY: e.clientY,
        button: e.button,
        buttons: e.buttons,
      });
    let replayPointerId: number | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      const canvas = canvasRef.current;
      if (!canvas || !insideStack(e.clientX, e.clientY)) return;
      e.stopPropagation();
      canvas.style.pointerEvents = "auto";
      replayPointerId = e.pointerId;
      canvas.dispatchEvent(clonePointerEvent("pointerdown", e));
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== replayPointerId) return;
      replayPointerId = null;
      const canvas = canvasRef.current;
      if (!canvas) return;
      e.stopPropagation();
      canvas.dispatchEvent(clonePointerEvent("pointerup", e));
      canvas.style.pointerEvents = "none";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
    };
  }, []);

  useEffect(
    () =>
      usePreferencesStore.subscribe(() => {
        arrowRef.current?.setTheme(getTheme());
        stackRef.current?.setTheme(getTheme());
      }),
    [],
  );

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: "100%", height: "100%", display: "block", pointerEvents: "none" }}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
