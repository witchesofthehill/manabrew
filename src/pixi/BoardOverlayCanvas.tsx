import { useEffect, useRef, useState } from "react";
import { Application } from "pixi.js";
import { destroyPixiApp, installPixiPatches } from "./pixiPatches";

installPixiPatches();

import { ArrowLayer } from "./ArrowLayer";
import { OverlayRenderScheduler, overlayResolution } from "./overlay/overlayRuntime";
import { installOverlayPointerRouting } from "./overlay/pointerRouting";
import { StackLayer } from "./stack/StackLayer";
import type { StackSpec } from "./stack/stack.types";
import { getTheme } from "@/hooks/useTheme";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import type { BoardScene } from "./board/BoardScene";
import { useKeybindings } from "@/hooks/useKeybindings";

interface BoardOverlayCanvasProps {
  scene: BoardScene | null;
  stackSpec: StackSpec;
  onOpenStack: () => void;
  onTargetSpell: (spellId: string) => void;
  onHoverStack: (stackObjectId: string | null) => void;
  onToggleStack: () => void;
  className?: string;
}

export function BoardOverlayCanvas({
  scene,
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
  const schedulerRef = useRef<OverlayRenderScheduler | null>(null);
  const sceneRef = useRef(scene);
  const stackSpecRef = useRef(stackSpec);
  const [hoveredStackObjectId, setHoveredStackObjectId] = useState<string | null>(null);

  const cbRef = useRef({ onOpenStack, onTargetSpell, onHoverStack, onToggleStack });
  useEffect(() => {
    cbRef.current = { onOpenStack, onTargetSpell, onHoverStack, onToggleStack };
  }, [onOpenStack, onTargetSpell, onHoverStack, onToggleStack]);

  useEffect(() => {
    sceneRef.current = scene;
    schedulerRef.current?.request();
  }, [scene]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let active = true;
    let initialized = false;
    let destroyed = false;
    let registeredScene: BoardScene | null = null;
    let arrow: ArrowLayer | null = null;
    let stack: StackLayer | null = null;
    let scheduler: OverlayRenderScheduler | null = null;
    const app = new Application();
    appRef.current = app;

    const teardown = (): void => {
      if (destroyed) return;
      destroyed = true;
      scheduler?.dispose();
      registeredScene?.setStackAnchorProvider(null);
      registeredScene?.setOverlayInvalidation(null);
      arrow?.destroy();
      stack?.destroy();
      if (schedulerRef.current === scheduler) schedulerRef.current = null;
      if (arrowRef.current === arrow) arrowRef.current = null;
      if (stackRef.current === stack) stackRef.current = null;
      if (appRef.current === app) appRef.current = null;
      destroyPixiApp(app);
    };

    const initialize = async (): Promise<void> => {
      try {
        const parent = canvas.parentElement;
        const width = Math.max(1, parent?.clientWidth ?? canvas.clientWidth);
        const height = Math.max(1, parent?.clientHeight ?? canvas.clientHeight);
        await app.init({
          canvas,
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          autoStart: false,
          resolution: overlayResolution(width, height),
        });
        initialized = true;
        if (!active || !app.renderer) {
          teardown();
          return;
        }

        app.stage.eventMode = "static";
        app.stage.sortableChildren = true;

        arrow = new ArrowLayer();
        arrow.setTheme(getTheme());
        arrow.graphics.eventMode = "none";
        arrowRef.current = arrow;

        stack = new StackLayer(getTheme(), {
          onOpen: () => cbRef.current.onOpenStack(),
          onTargetSpell: (id) => cbRef.current.onTargetSpell(id),
          onHover: (id) => {
            setHoveredStackObjectId(id);
            cbRef.current.onHoverStack(id);
          },
          onToggleCollapsed: () => cbRef.current.onToggleStack(),
        });
        stackRef.current = stack;
        stack.setViewport(width, height);
        stack.setSpec(stackSpecRef.current);

        app.stage.addChild(stack.container);
        app.stage.addChild(arrow.graphics);
        app.renderer.resize(width, height);

        scheduler = new OverlayRenderScheduler(app, (deltaMs) => {
          const scene = sceneRef.current;
          if (scene !== registeredScene) {
            registeredScene?.setStackAnchorProvider(null);
            registeredScene?.setOverlayInvalidation(null);
            registeredScene = scene;
            registeredScene?.setStackAnchorProvider(stack);
            registeredScene?.setOverlayInvalidation(() => scheduler?.request());
          }
          const definitions = scene?.getArrowDefs() ?? [];
          arrow?.update(definitions, deltaMs);
          return definitions.length > 0 || stack?.isAnimating() === true;
        });
        schedulerRef.current = scheduler;
        scheduler.request();
      } catch (error) {
        if (active) console.error("[pixi] BoardOverlayCanvas init failed:", error);
        teardown();
      }
    };

    void initialize();
    return () => {
      active = false;
      canvas.style.pointerEvents = "none";
      if (initialized) teardown();
      else if (appRef.current === app) appRef.current = null;
    };
  }, []);

  useEffect(() => {
    stackSpecRef.current = stackSpec;
    stackRef.current?.setSpec(stackSpec);
    schedulerRef.current?.request();
  }, [stackSpec]);

  useEffect(() => {
    const parent = canvasRef.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const renderer = appRef.current?.renderer;
        if (width <= 0 || height <= 0 || !renderer) continue;
        renderer.resolution = overlayResolution(width, height);
        renderer.resize(width, height);
        stackRef.current?.setViewport(width, height);
        schedulerRef.current?.request();
      }
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return installOverlayPointerRouting({
      canvas,
      hitTest: (clientX, clientY) => {
        const stack = stackRef.current;
        if (!stack) return false;
        const rect = canvas.getBoundingClientRect();
        return stack.hitTest(clientX - rect.left, clientY - rect.top);
      },
      onActivity: () => schedulerRef.current?.request(),
      onOverlayCancel: (pointerId) => stackRef.current?.cancelPointer(pointerId),
    });
  }, []);

  useEffect(
    () =>
      usePreferencesStore.subscribe(() => {
        arrowRef.current?.setTheme(getTheme());
        stackRef.current?.setTheme(getTheme());
        schedulerRef.current?.request();
      }),
    [],
  );

  const hoveredStackCard = stackSpec.cards.find((card) => card.id === hoveredStackObjectId);

  useKeybindings(
    hoveredStackObjectId && hoveredStackCard?.card.isDoubleFaced
      ? {
          "flip-card": () => {
            stackRef.current?.toggleFace(hoveredStackObjectId);
            schedulerRef.current?.request();
          },
        }
      : {},
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
