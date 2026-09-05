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
import type { ClientCardDto } from "@/stores/gameStore.types";
import type { HandActionOption } from "@/stores/useGameUIStore";
import { bindPreviewScroll } from "./cardPreview/previewScroll";

export interface BoardOverlayPreviewSpec {
  card: ClientCardDto;
  phase: "open" | "closing";
  sticky: boolean;
  showBackFace: boolean;
  suppressed: boolean;
  actions: HandActionOption[];
  mousePos: { x: number; y: number };
  anchorRect: DOMRect | null;
  viewportRight?: number;
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

function updateRulesPreview(
  preview: RulesCardPreviewLayer,
  spec: BoardOverlayPreviewSpec | null | undefined,
  canvasRect: DOMRect,
  width = canvasRect.width,
  height = canvasRect.height,
): void {
  const previewWidth = Math.min(width, (spec?.viewportRight ?? canvasRect.right) - canvasRect.left);
  if (!(previewWidth > 0) || !(height > 0)) {
    preview.setSpec(null);
    return;
  }
  preview.setViewport(previewWidth, height);
  preview.setSpec(spec ? toRulesPreviewSpec(spec, canvasRect) : null);
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
        }
        const currentSpec = previewSpecRef.current;
        const canvasRect = canvasRef.current?.getBoundingClientRect();
        if (canvasRect) {
          updateRulesPreview(preview, currentSpec, canvasRect, w, h);
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
    updateRulesPreview(preview, previewSpec, canvas.getBoundingClientRect());
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
          const preview = previewRef.current;
          const canvasRect = canvasRef.current?.getBoundingClientRect();
          if (preview && canvasRect) {
            updateRulesPreview(preview, previewSpecRef.current, canvasRect, width, height);
          }
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
    const unbindPreviewScroll = bindPreviewScroll(
      window,
      (x, y) => hitAt(x, y).preview,
      (delta, mode, clientY) => {
        const canvas = canvasRef.current;
        if (canvas) {
          previewRef.current?.scrollBy(delta, mode, clientY - canvas.getBoundingClientRect().top);
        }
      },
    );
    const onMove = (event: PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (replayPointerId !== null) return;
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
    let dismissedPointerId: number | null = null;
    let dismissedClickPointerId: number | null = null;
    const onDown = (event: PointerEvent) => {
      if (!event.isTrusted) return;
      dismissedClickPointerId = null;
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
          dismissedPointerId = event.pointerId;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }

      if (event.pointerType !== "touch" || (!hit.stack && !hit.preview)) return;
      event.stopPropagation();
      if (replayPointerId !== null) return;
      canvas.style.pointerEvents = "auto";
      replayPointerId = event.pointerId;
      canvas.dispatchEvent(clonePointerEvent("pointerdown", event));
      canvas.setPointerCapture(event.pointerId);
    };
    const onUp = (event: PointerEvent) => {
      if (!event.isTrusted) return;
      if (event.pointerId === dismissedPointerId) {
        dismissedPointerId = null;
        dismissedClickPointerId = event.type === "pointerup" ? event.pointerId : null;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.pointerId !== replayPointerId) return;
      replayPointerId = null;
      const canvas = canvasRef.current;
      if (!canvas) return;
      event.stopPropagation();
      canvas.dispatchEvent(clonePointerEvent(event.type, event));
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      canvas.style.pointerEvents = "none";
    };
    const onClick = (event: MouseEvent) => {
      if (dismissedClickPointerId === null || event.detail === 0) return;
      if (
        event instanceof PointerEvent &&
        event.pointerId >= 0 &&
        event.pointerId !== dismissedClickPointerId
      ) {
        return;
      }
      dismissedClickPointerId = null;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    window.addEventListener("click", onClick, true);
    return () => {
      unbindPreviewScroll();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      window.removeEventListener("click", onClick, true);
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

  useKeybindings({
    ...(rulesPreviewOpen && previewSpec.actions.length > 0
      ? {
          "preview-prev-action": () => previewRef.current?.focusAction(-1),
          "preview-next-action": () => previewRef.current?.focusAction(1),
          "preview-activate-action": () => previewRef.current?.activateFocusedAction(),
        }
      : {}),
    ...(rulesPreviewOpen ? { "preview-dismiss": () => cbRef.current.onDismissPreview?.() } : {}),
    ...(rulesPreviewOpen
      ? { "flip-card": () => previewRef.current?.activatePrimaryTransform() }
      : hoveredStackObjectId && hoveredStackCard?.card.isDoubleFaced
        ? { "flip-card": () => stackRef.current?.toggleFace(hoveredStackObjectId) }
        : {}),
  });

  useEffect(() => {
    if (!rulesPreviewOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
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
      style={{
        width: "100%",
        height: "100%",
        display: "block",
        pointerEvents: "none",
        touchAction: "none",
      }}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
