import { useEffect, useRef, useState } from "react";
import { Application } from "pixi.js";
import { destroyPixiApp, installPixiPatches } from "./pixiPatches";

installPixiPatches();

import { ArrowLayer } from "./ArrowLayer";
import { StackLayer } from "./stack/StackLayer";
import type { StackSpec } from "./stack/stack.types";
import { useTheme } from "@/hooks/useTheme";
import { GHOST_CLICK_ARM_MS, isCoarsePointer } from "@/lib/responsive";
import { registerPixiApp } from "./visibility";
import { PIXI_MAX_FPS } from "./constants";
import type { BoardScene } from "./board/BoardScene";
import { useKeybindings } from "@/hooks/useKeybindings";
import {
  RulesCardPreviewLayer,
  type RulesCardPreviewSpec,
} from "./cardPreview/RulesCardPreviewLayer";
import type { CardDto } from "@/protocol/game";
import type { HandActionOption } from "@/stores/useGameUIStore";

export interface BoardOverlayPreviewSpec {
  card: CardDto;
  phase: "open" | "closing";
  sticky: boolean;
  showBackFace: boolean;
  suppressed: boolean;
  actions: HandActionOption[];
  mousePos: { x: number; y: number };
  anchorRect: DOMRect | null;
}

interface BoardOverlayCanvasProps {
  sceneRef: React.MutableRefObject<BoardScene | null>;
  stackSpec: StackSpec;
  onOpenStack: () => void;
  onTargetSpell: (spellId: string) => void;
  onHoverStack: (stackObjectId: string | null) => void;
  onToggleStack: () => void;
  className?: string;
  previewSpec?: BoardOverlayPreviewSpec | null;
  onPreviewPointerEnter?: () => void;
  onPreviewPointerLeave?: () => void;
  onSelectPreviewAction?: (action: HandActionOption) => void;
  onDismissPreview?: () => void;
  onFlipPreview?: () => void;
}
function toRulesPreviewSpec(
  spec: BoardOverlayPreviewSpec,
  canvasRect: DOMRect,
): RulesCardPreviewSpec {
  return {
    card: spec.card,
    phase: spec.phase,
    sticky: spec.sticky,
    showBackFace: spec.showBackFace,
    suppressed: spec.suppressed,
    actions: spec.actions,
    anchor: spec.anchorRect
      ? {
          x: spec.anchorRect.x - canvasRect.left,
          y: spec.anchorRect.y - canvasRect.top,
          width: spec.anchorRect.width,
          height: spec.anchorRect.height,
        }
      : null,
    pointer: {
      x: spec.mousePos.x - canvasRect.left,
      y: spec.mousePos.y - canvasRect.top,
    },
  };
}

export function BoardOverlayCanvas({
  sceneRef,
  stackSpec,
  onOpenStack,
  onTargetSpell,
  onHoverStack,
  onToggleStack,
  className,
  previewSpec,
  onPreviewPointerEnter,
  onPreviewPointerLeave,
  onSelectPreviewAction,
  onDismissPreview,
  onFlipPreview,
}: BoardOverlayCanvasProps) {
  const theme = useTheme();
  const themeRef = useRef(theme);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<Application | null>(null);
  const arrowRef = useRef<ArrowLayer | null>(null);
  const stackRef = useRef<StackLayer | null>(null);
  const previewRef = useRef<RulesCardPreviewLayer | null>(null);
  const previewSpecRef = useRef(previewSpec);
  const stickyOpenedAtRef = useRef(0);
  const stickyPreviewKeyRef = useRef<string | null>(null);
  const unregisterRef = useRef<(() => void) | null>(null);
  const [hoveredStackObjectId, setHoveredStackObjectId] = useState<string | null>(null);

  const cbRef = useRef({
    onOpenStack,
    onTargetSpell,
    onHoverStack,
    onToggleStack,
    onPreviewPointerEnter,
    onPreviewPointerLeave,
    onSelectPreviewAction,
    onDismissPreview,
    onFlipPreview,
  });
  useEffect(() => {
    cbRef.current = {
      onOpenStack,
      onTargetSpell,
      onHoverStack,
      onToggleStack,
      onPreviewPointerEnter,
      onPreviewPointerLeave,
      onSelectPreviewAction,
      onDismissPreview,
      onFlipPreview,
    };
  }, [
    onDismissPreview,
    onFlipPreview,
    onHoverStack,
    onOpenStack,
    onPreviewPointerEnter,
    onPreviewPointerLeave,
    onSelectPreviewAction,
    onTargetSpell,
    onToggleStack,
  ]);

  useEffect(() => {
    previewSpecRef.current = previewSpec;
    const stickyPreviewKey =
      previewSpec?.sticky && previewSpec.phase === "open" ? previewSpec.card.id : null;
    if (stickyPreviewKey === stickyPreviewKeyRef.current) return;
    stickyPreviewKeyRef.current = stickyPreviewKey;
    stickyOpenedAtRef.current = stickyPreviewKey ? Date.now() : 0;
  }, [previewSpec]);

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
        arrow.setTheme(themeRef.current);
        arrow.graphics.eventMode = "none";
        arrowRef.current = arrow;

        const stack = new StackLayer(themeRef.current, {
          onOpen: () => cbRef.current.onOpenStack(),
          onTargetSpell: (id) => cbRef.current.onTargetSpell(id),
          onHover: (id) => {
            setHoveredStackObjectId(id);
            cbRef.current.onHoverStack(id);
          },
          onToggleCollapsed: () => cbRef.current.onToggleStack(),
        });
        stackRef.current = stack;
        const preview = new RulesCardPreviewLayer(themeRef.current, {
          onPointerEnter: () => cbRef.current.onPreviewPointerEnter?.(),
          onPointerLeave: () => cbRef.current.onPreviewPointerLeave?.(),
          onSelectAction: (action) => cbRef.current.onSelectPreviewAction?.(action),
          onDismiss: () => cbRef.current.onDismissPreview?.(),
          onFlip: () => cbRef.current.onFlipPreview?.(),
        });
        preview.container.zIndex = 10_000;
        previewRef.current = preview;

        app.stage.addChild(stack.container);
        app.stage.addChild(arrow.graphics);
        app.stage.addChild(preview.container);

        const parent = canvasRef.current?.parentElement;
        const w = parent?.clientWidth ?? 0;
        const h = parent?.clientHeight ?? 0;
        if (w > 0 && h > 0) {
          app.renderer.resize(w, h);
          stack.setViewport(w, h);
          preview.setViewport(w, h);
        }
        const currentSpec = previewSpecRef.current;
        const canvasRect = canvasRef.current?.getBoundingClientRect();
        if (currentSpec && canvasRect) {
          preview.setSpec(toRulesPreviewSpec(currentSpec, canvasRect));
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
      previewRef.current?.destroy();
      previewRef.current = null;
      destroyPixiApp(appRef.current);
      appRef.current = null;
    };
  }, [sceneRef]);

  useEffect(() => {
    stackRef.current?.setSpec(stackSpec);
  }, [stackSpec]);
  useEffect(() => {
    const preview = previewRef.current;
    const canvas = canvasRef.current;
    if (!preview || !canvas) return;
    preview.setSpec(
      previewSpec ? toRulesPreviewSpec(previewSpec, canvas.getBoundingClientRect()) : null,
    );
    if (!previewSpec || previewSpec.phase !== "open" || previewSpec.suppressed) {
      canvas.style.pointerEvents = "none";
    }
  }, [previewSpec]);

  useEffect(() => {
    const parent = canvasRef.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          appRef.current?.renderer?.resize(width, height);
          stackRef.current?.setViewport(width, height);
          previewRef.current?.setViewport(width, height);
        }
      }
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const hitAt = (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { stack: false, preview: false };
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      return {
        stack: stackRef.current?.hitTest(x, y) ?? false,
        preview: previewRef.current?.hitTest(x, y) ?? false,
      };
    };
    const onMove = (event: PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const hit = hitAt(event.clientX, event.clientY);
      canvas.style.pointerEvents = hit.stack || hit.preview ? "auto" : "none";
    };
    const clonePointerEvent = (type: string, event: PointerEvent) =>
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        isPrimary: event.isPrimary,
        clientX: event.clientX,
        clientY: event.clientY,
        button: event.button,
        buttons: event.buttons,
      });
    let replayPointerId: number | null = null;
    const onDown = (event: PointerEvent) => {
      if (!event.isTrusted) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const hit = hitAt(event.clientX, event.clientY);
      const currentPreview = previewSpecRef.current;
      const stickyOpen =
        currentPreview?.sticky &&
        currentPreview.phase === "open" &&
        !currentPreview.suppressed &&
        Date.now() - stickyOpenedAtRef.current >= GHOST_CLICK_ARM_MS;

      if (stickyOpen && !hit.preview) {
        cbRef.current.onDismissPreview?.();
        if (event.pointerType === "touch" && !hit.stack) {
          event.stopPropagation();
          return;
        }
      }

      if (event.pointerType !== "touch" || (!hit.stack && !hit.preview)) return;
      event.stopPropagation();
      canvas.style.pointerEvents = "auto";
      replayPointerId = event.pointerId;
      canvas.dispatchEvent(clonePointerEvent("pointerdown", event));
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== replayPointerId) return;
      if (!event.isTrusted) return;
      replayPointerId = null;
      const canvas = canvasRef.current;
      if (!canvas) return;
      event.stopPropagation();
      canvas.dispatchEvent(clonePointerEvent("pointerup", event));
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

  useEffect(() => {
    themeRef.current = theme;
    arrowRef.current?.setTheme(theme);
    stackRef.current?.setTheme(theme);
    previewRef.current?.setTheme(theme);
  }, [theme]);

  const hoveredStackCard = stackSpec.cards.find((card) => card.id === hoveredStackObjectId);
  const rulesPreviewOpen = previewSpec?.phase === "open" && !previewSpec.suppressed;
  const previewCanFlip = rulesPreviewOpen && previewSpec.card.isDoubleFaced;

  useKeybindings({
    ...(rulesPreviewOpen
      ? {
          "preview-prev-action": () => previewRef.current?.focusAction(-1),
          "preview-next-action": () => previewRef.current?.focusAction(1),
          "preview-activate-action": () => previewRef.current?.activateFocusedAction(),
          "preview-dismiss": () => cbRef.current.onDismissPreview?.(),
        }
      : {}),
    ...(previewCanFlip
      ? { "flip-card": () => cbRef.current.onFlipPreview?.() }
      : hoveredStackObjectId && hoveredStackCard?.card.isDoubleFaced
        ? { "flip-card": () => stackRef.current?.toggleFace(hoveredStackObjectId) }
        : {}),
  });

  useEffect(() => {
    if (!rulesPreviewOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return;
      }
      const shortcut = Number.parseInt(event.key, 10);
      if (shortcut < 1 || shortcut > 9) return;
      if (previewRef.current?.activateShortcut(shortcut)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [rulesPreviewOpen]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: "100%", height: "100%", display: "block", pointerEvents: "none" }}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
