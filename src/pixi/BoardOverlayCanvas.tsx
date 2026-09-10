// @refresh reset
import { topModal } from "@/lib/modalStack";

import { useEffect, useRef, useState } from "react";
import { Application, Graphics } from "pixi.js";
import { destroyPixiApp, installPixiPatches } from "./pixiPatches";

installPixiPatches();

import { ArrowLayer } from "./ArrowLayer";
import { OverlayRenderScheduler, overlayResolution } from "./overlay/overlayRuntime";
import { installOverlayPointerRouting } from "./overlay/pointerRouting";
import { StackLayer } from "./stack/StackLayer";
import type { StackSpec } from "./stack/stack.types";
import { useTheme } from "@/hooks/useTheme";
import { GHOST_CLICK_ARM_MS } from "@/lib/responsive";
import type { TargetRef } from "@/protocol/prompts/common";
import { intentIsHostile } from "@/types/promptType";
import type { BoardScene } from "./board/BoardScene";
import type { BlockingRect } from "./board/types";
import { useKeybindings } from "@/hooks/useKeybindings";
import { PromptLayer } from "./prompts/PromptLayer";
import type { PromptOverlaySpec } from "./prompts/prompt.types";
import {
  RulesCardPreviewLayer,
  type RulesPreviewActionGlowBounds,
  type RulesCardPreviewSpec,
} from "./cardPreview/RulesCardPreviewLayer";
import {
  CommandZonePreviewLayer,
  type CommandZonePreviewLayerSpec,
} from "./cardPreview/CommandZonePreviewLayer";
import type { ClientCardDto } from "@/stores/gameStore.types";
import type { HandActionOption } from "@/stores/useGameUIStore";
import { bindPreviewScroll } from "./cardPreview/previewScroll";
import {
  ACTIONABLE_CARD_GLOW_CLASS,
  actionableCardGlowStyle,
} from "@/components/game/cardPreviewStyles";
import { cn } from "@/lib/utils";
import { usePreferencesStore, type InGameCardPreviewStyle } from "@/stores/usePreferencesStore";
import { hexToNum } from "./colorUtils";

export interface BoardOverlayPreviewSpec {
  card: ClientCardDto;
  phase: "open" | "closing";
  sticky: boolean;
  showBackFace: boolean;
  suppressed: boolean;
  skipEnterAnimation: boolean;
  actions: HandActionOption[];
  mousePos: { x: number; y: number };
  anchorRect: DOMRect | null;
  viewportRight?: number;
  slotRect?: DOMRect | null;
}

export interface BoardOverlayCommandPreviewSpec {
  cards: ClientCardDto[];
  castableCardIds: string[];
  style: InGameCardPreviewStyle;
  phase: "open" | "closing";
  suppressed: boolean;
  anchorRect: DOMRect;
  viewportRight?: number;
}
const PREVIEW_BACKDROP_ALPHA = 0.3;

function hasRulesPreviewBackdrop(
  spec: BoardOverlayPreviewSpec | null | undefined,
): spec is BoardOverlayPreviewSpec {
  return !!spec && spec.sticky && !spec.suppressed && spec.actions.length > 0;
}

function updateRulesPreviewBackdrop(
  backdrop: Graphics,
  spec: BoardOverlayPreviewSpec | null | undefined,
  width: number,
  height: number,
  color: string,
): void {
  backdrop.clear();
  backdrop.visible = hasRulesPreviewBackdrop(spec) && width > 0 && height > 0;
  if (backdrop.visible) {
    backdrop.rect(0, 0, width, height).fill({
      color: hexToNum(color),
      alpha: PREVIEW_BACKDROP_ALPHA,
    });
  }
}

interface BoardOverlayCanvasProps {
  scene: BoardScene | null;
  stackSpec: StackSpec;
  onOpenStack: () => void;
  onTargetSpell: (spellId: string) => void;
  onHoverStack: (stackObjectId: string | null) => void;
  onToggleStack: () => void;
  promptSpec: PromptOverlaySpec | null;
  className?: string;
  externalPreviewActive?: boolean;
  previewSpec?: BoardOverlayPreviewSpec | null;
  commandPreviewSpec?: BoardOverlayCommandPreviewSpec | null;
  onCastCommandCard?: (cardId: string) => void;
  onPreviewPointerEnter?: () => void;
  onPreviewPointerLeave?: () => void;
  onSelectPreviewAction?: (action: HandActionOption) => void;
  onDismissPreview?: () => void;
  onFlipPreview?: () => void;
  onTogglePreviewView?: () => void;
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
    skipEnterAnimation: spec.skipEnterAnimation,
    actions: spec.actions,
    anchor: spec.anchorRect
      ? {
          x: spec.anchorRect.x - canvasRect.left,
          y: spec.anchorRect.y - canvasRect.top,
          width: spec.anchorRect.width,
          height: spec.anchorRect.height,
        }
      : null,
    slot: spec.slotRect
      ? {
          x: spec.slotRect.x - canvasRect.left,
          y: spec.slotRect.y - canvasRect.top,
          width: spec.slotRect.width,
          height: spec.slotRect.height,
        }
      : null,
    pointer: {
      x: spec.mousePos.x - canvasRect.left,
      y: spec.mousePos.y - canvasRect.top,
    },
  };
}

function toCommandPreviewSpec(
  spec: BoardOverlayCommandPreviewSpec,
  canvasRect: DOMRect,
): CommandZonePreviewLayerSpec {
  return {
    cards: spec.cards,
    castableCardIds: spec.castableCardIds,
    style: spec.style,
    phase: spec.phase,
    suppressed: spec.suppressed,
    anchor: {
      x: spec.anchorRect.x - canvasRect.left,
      y: spec.anchorRect.y - canvasRect.top,
      width: spec.anchorRect.width,
      height: spec.anchorRect.height,
    },
    viewportRight: spec.viewportRight == null ? undefined : spec.viewportRight - canvasRect.left,
  };
}

function updateRulesPreview(
  preview: RulesCardPreviewLayer,
  spec: BoardOverlayPreviewSpec | null | undefined,
  canvasRect: DOMRect,
  preserveHover = false,
  width = canvasRect.width,
  height = canvasRect.height,
): void {
  const previewWidth = Math.min(width, (spec?.viewportRight ?? canvasRect.right) - canvasRect.left);
  if (!(previewWidth > 0) || !(height > 0)) {
    preview.setSpec(null);
    return;
  }
  preview.setViewport(previewWidth, height);
  preview.setSpec(spec ? toRulesPreviewSpec(spec, canvasRect) : null, preserveHover);
}

interface RulesPreviewActionGlowSyncState extends RulesPreviewActionGlowBounds {
  visible: boolean;
}

function syncRulesPreviewActionGlow(
  element: HTMLDivElement | null,
  preview: RulesCardPreviewLayer,
  bounds: RulesPreviewActionGlowBounds,
  state: RulesPreviewActionGlowSyncState,
): void {
  if (!element) return;
  if (!preview.readActionGlowBounds(bounds)) {
    if (state.visible) element.style.visibility = "hidden";
    state.visible = false;
    return;
  }
  if (!state.visible) element.style.visibility = "visible";
  if (bounds.x !== state.x || bounds.y !== state.y) {
    element.style.transform = `translate3d(${bounds.x}px, ${bounds.y}px, 0)`;
  }
  if (bounds.width !== state.width) element.style.width = `${bounds.width}px`;
  if (bounds.height !== state.height) element.style.height = `${bounds.height}px`;
  if (bounds.radius !== state.radius) element.style.borderRadius = `${bounds.radius}px`;
  if (bounds.opacity !== state.opacity) element.style.opacity = String(bounds.opacity);
  state.x = bounds.x;
  state.y = bounds.y;
  state.width = bounds.width;
  state.height = bounds.height;
  state.radius = bounds.radius;
  state.opacity = bounds.opacity;
  state.visible = true;
}

export function BoardOverlayCanvas({
  scene,
  stackSpec,
  onOpenStack,
  onTargetSpell,
  onHoverStack,
  onToggleStack,
  promptSpec,
  className,
  externalPreviewActive = false,
  previewSpec,
  commandPreviewSpec,
  onCastCommandCard,
  onPreviewPointerEnter,
  onPreviewPointerLeave,
  onSelectPreviewAction,
  onDismissPreview,
  onFlipPreview,
  onTogglePreviewView,
}: BoardOverlayCanvasProps) {
  const theme = useTheme();
  const stackCardStyle = usePreferencesStore((state) => state.stackCardStyle);
  const themeRef = useRef(theme);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewGlowRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const arrowRef = useRef<ArrowLayer | null>(null);
  const stackRef = useRef<StackLayer | null>(null);
  const promptRef = useRef<PromptLayer | null>(null);
  const schedulerRef = useRef<OverlayRenderScheduler | null>(null);
  const sceneRef = useRef(scene);
  const previewRef = useRef<RulesCardPreviewLayer | null>(null);
  const commandPreviewRef = useRef<CommandZonePreviewLayer | null>(null);
  const previewBackdropRef = useRef<Graphics | null>(null);
  const syncPreviewPointerRef = useRef<(() => void) | null>(null);
  const previewSpecRef = useRef(previewSpec);
  const commandPreviewSpecRef = useRef(commandPreviewSpec);
  const stackSpecRef = useRef(stackSpec);
  const stackCardStyleRef = useRef(stackCardStyle);
  const stickyOpenedAtRef = useRef(0);
  const stickyPreviewKeyRef = useRef<string | null>(null);
  const [hoveredStackObjectId, setHoveredStackObjectId] = useState<string | null>(null);

  const cbRef = useRef({
    onOpenStack,
    onTargetSpell,
    onHoverStack,
    onToggleStack,
    onPreviewPointerEnter,
    onCastCommandCard,
    onPreviewPointerLeave,
    onSelectPreviewAction,
    onDismissPreview,
    onFlipPreview,
    onTogglePreviewView,
  });
  const promptSpecRef = useRef(promptSpec);
  useEffect(() => {
    cbRef.current = {
      onOpenStack,
      onTargetSpell,
      onHoverStack,
      onToggleStack,
      onPreviewPointerEnter,
      onCastCommandCard,
      onPreviewPointerLeave,
      onSelectPreviewAction,
      onDismissPreview,
      onFlipPreview,
      onTogglePreviewView,
    };
  }, [
    onCastCommandCard,
    onDismissPreview,
    onFlipPreview,
    onHoverStack,
    onOpenStack,
    onPreviewPointerEnter,
    onPreviewPointerLeave,
    onSelectPreviewAction,
    onTargetSpell,
    onTogglePreviewView,
    onToggleStack,
  ]);
  useEffect(() => {
    promptSpecRef.current = promptSpec;
  }, [promptSpec]);

  useEffect(() => {
    previewSpecRef.current = previewSpec;
    const stickyPreviewKey =
      previewSpec?.sticky && previewSpec.phase === "open" ? previewSpec.card.id : null;
    if (stickyPreviewKey === stickyPreviewKeyRef.current) return;
    stickyPreviewKeyRef.current = stickyPreviewKey;
    stickyOpenedAtRef.current = stickyPreviewKey ? Date.now() : 0;
  }, [previewSpec]);
  useEffect(() => {
    commandPreviewSpecRef.current = commandPreviewSpec;
  }, [commandPreviewSpec]);

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
    let lastPromptBlockers = "";
    let arrow: ArrowLayer | null = null;
    let stack: StackLayer | null = null;
    let prompt: PromptLayer | null = null;
    let preview: RulesCardPreviewLayer | null = null;
    let commandPreview: CommandZonePreviewLayer | null = null;
    let previewBackdrop: Graphics | null = null;
    let scheduler: OverlayRenderScheduler | null = null;
    const glowBounds: RulesPreviewActionGlowBounds = {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      radius: 0,
      opacity: 0,
    };
    const glowState: RulesPreviewActionGlowSyncState = {
      x: Number.NaN,
      y: Number.NaN,
      width: Number.NaN,
      height: Number.NaN,
      radius: Number.NaN,
      opacity: Number.NaN,
      visible: false,
    };
    const app = new Application();
    appRef.current = app;

    const teardown = (): void => {
      if (destroyed) return;
      destroyed = true;
      scheduler?.dispose();
      registeredScene?.setStackAnchorProvider(null);
      registeredScene?.setOverlayInvalidation(null);
      registeredScene?.setOverlayHitTest(null);
      registeredScene?.setPromptReference(null);
      registeredScene?.setPlayerBlockers(new Map());
      stack?.setPromptReference(null, null);
      arrow?.destroy();
      stack?.destroy();
      prompt?.destroy();
      preview?.destroy();
      commandPreview?.destroy();
      previewBackdrop?.destroy();
      if (schedulerRef.current === scheduler) schedulerRef.current = null;
      if (arrowRef.current === arrow) arrowRef.current = null;
      if (stackRef.current === stack) stackRef.current = null;
      if (promptRef.current === prompt) promptRef.current = null;
      if (previewRef.current === preview) previewRef.current = null;
      if (commandPreviewRef.current === commandPreview) commandPreviewRef.current = null;
      if (previewBackdropRef.current === previewBackdrop) previewBackdropRef.current = null;
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
        arrow.setTheme(themeRef.current);
        arrow.graphics.eventMode = "none";
        arrowRef.current = arrow;

        stack = new StackLayer(themeRef.current, {
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
        stack.setRulesViewDefault(stackCardStyleRef.current === "rules");

        const promptLayer = new PromptLayer(app, {
          onReferenceChange: (target: TargetRef | null) => {
            const sceneTarget = target?.kind === "spell" ? null : target;
            sceneRef.current?.setPromptReference(sceneTarget);
            const color =
              target?.intent != null && intentIsHostile(target.intent)
                ? themeRef.current.gameTheme.pointer.hostile
                : themeRef.current.gameTheme.pointer.friendly;
            stackRef.current?.setPromptReference(
              target?.kind === "spell" ? target.id : null,
              target ? hexToNum(color) : null,
            );
          },
          getReferenceAnchor: (target) =>
            target.kind === "spell"
              ? (stackRef.current?.getAnchor(target.id) ?? null)
              : (sceneRef.current?.getPromptReferenceAnchor(target) ?? null),
        });
        prompt = promptLayer;
        promptRef.current = promptLayer;
        promptLayer.setViewport(width, height);
        promptLayer.setSpec(promptSpecRef.current);

        const backdrop = new Graphics();
        backdrop.eventMode = "none";
        backdrop.zIndex = 9_999;
        previewBackdrop = backdrop;
        previewBackdropRef.current = backdrop;
        const previewLayer = new RulesCardPreviewLayer(themeRef.current, {
          onPointerEnter: () => cbRef.current.onPreviewPointerEnter?.(),
          onPointerLeave: () => cbRef.current.onPreviewPointerLeave?.(),
          onInteractionReady: () => {
            syncPreviewPointerRef.current?.();
            scheduler?.request();
          },
          onSelectAction: (action) => cbRef.current.onSelectPreviewAction?.(action),
          onDismiss: () => cbRef.current.onDismissPreview?.(),
          onFlip: () => cbRef.current.onFlipPreview?.(),
          onToggleView: () => cbRef.current.onTogglePreviewView?.(),
        });
        previewLayer.container.zIndex = 10_001;
        preview = previewLayer;
        previewRef.current = previewLayer;
        const commandPreviewLayer = new CommandZonePreviewLayer(themeRef.current, {
          onPointerEnter: () => cbRef.current.onPreviewPointerEnter?.(),
          onPointerLeave: () => cbRef.current.onPreviewPointerLeave?.(),
          onInteractionReady: () => {
            syncPreviewPointerRef.current?.();
            scheduler?.request();
          },
          onCastCard: (cardId) => {
            cbRef.current.onDismissPreview?.();
            cbRef.current.onCastCommandCard?.(cardId);
          },
        });
        commandPreviewLayer.container.zIndex = 10_001;
        commandPreview = commandPreviewLayer;
        commandPreviewRef.current = commandPreviewLayer;

        app.stage.addChild(stack.container);
        app.stage.addChild(arrow.graphics);
        app.stage.addChild(backdrop);
        app.stage.addChild(previewLayer.container);
        app.stage.addChild(commandPreviewLayer.container);
        app.renderer.resize(width, height);
        if (promptLayer.blocksBoard) canvas.style.pointerEvents = "auto";

        updateRulesPreviewBackdrop(
          backdrop,
          previewSpecRef.current,
          width,
          height,
          themeRef.current.gameTheme.canvas.shadow,
        );
        const currentSpec = previewSpecRef.current;
        const canvasRect = canvas.getBoundingClientRect();
        updateRulesPreview(previewLayer, currentSpec, canvasRect, false, width, height);
        commandPreviewLayer.setViewport(width, height);
        commandPreviewLayer.setSpec(
          commandPreviewSpecRef.current
            ? toCommandPreviewSpec(commandPreviewSpecRef.current, canvasRect)
            : null,
        );

        scheduler = new OverlayRenderScheduler(app, (deltaMs) => {
          const currentScene = sceneRef.current;
          if (currentScene !== registeredScene) {
            registeredScene?.setStackAnchorProvider(null);
            registeredScene?.setOverlayInvalidation(null);
            registeredScene?.setOverlayHitTest(null);
            registeredScene?.setPromptReference(null);
            registeredScene?.setPlayerBlockers(new Map());
            registeredScene = currentScene;
            lastPromptBlockers = "";
            registeredScene?.setStackAnchorProvider(stack);
            registeredScene?.setOverlayInvalidation(() => scheduler?.request());
            registeredScene?.setOverlayHitTest(
              (x, y) =>
                hasRulesPreviewBackdrop(previewSpecRef.current) ||
                previewLayer.hitTestHover(x, y) ||
                commandPreviewLayer.hitTest(x, y) ||
                promptLayer.hitTest(x, y) ||
                stack?.hitTest(x, y) === true,
            );
          }

          promptLayer.update(deltaMs);
          if (currentScene) {
            const bounds = promptLayer.getActionBounds();
            const spec = promptSpecRef.current;
            const blockers = new Map<string, BlockingRect[]>();
            if (bounds && spec) {
              blockers.set(spec.localPlayerId, [
                { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
              ]);
              if (promptLayer.compactAction) {
                for (const player of spec.gameView.players) {
                  if (player.id !== spec.localPlayerId) {
                    blockers.set(player.id, [
                      { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
                    ]);
                  }
                }
              }
            }
            const blockerKey = JSON.stringify([...blockers]);
            if (blockerKey !== lastPromptBlockers) {
              lastPromptBlockers = blockerKey;
              currentScene.setPlayerBlockers(blockers);
            }
          }

          const definitions = currentScene?.getArrowDefs() ?? [];
          arrow?.update(definitions, deltaMs);
          syncRulesPreviewActionGlow(previewGlowRef.current, previewLayer, glowBounds, glowState);
          return (
            definitions.length > 0 ||
            stack?.isAnimating() === true ||
            previewLayer.container.visible ||
            commandPreviewLayer.container.visible ||
            promptLayer.container.visible
          );
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
    stackCardStyleRef.current = stackCardStyle;
    stackRef.current?.setRulesViewDefault(stackCardStyle === "rules");
    schedulerRef.current?.request();
  }, [stackCardStyle]);
  useEffect(() => {
    const preview = previewRef.current;
    const commandPreview = commandPreviewRef.current;
    const canvas = canvasRef.current;
    if (!preview || !commandPreview || !canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    updateRulesPreview(preview, previewSpec, canvasRect, externalPreviewActive);
    commandPreview.setViewport(canvas.clientWidth, canvas.clientHeight);
    commandPreview.setSpec(
      commandPreviewSpec ? toCommandPreviewSpec(commandPreviewSpec, canvasRect) : null,
    );
    updateRulesPreviewBackdrop(
      previewBackdropRef.current!,
      previewSpec,
      canvas.clientWidth,
      canvas.clientHeight,
      themeRef.current.gameTheme.canvas.shadow,
    );
    const rulesOpen = !!previewSpec && previewSpec.phase === "open" && !previewSpec.suppressed;
    const commandOpen =
      !!commandPreviewSpec && commandPreviewSpec.phase === "open" && !commandPreviewSpec.suppressed;
    if (!rulesOpen && !commandOpen && !promptRef.current?.blocksBoard) {
      canvas.style.pointerEvents = "none";
    }
    syncPreviewPointerRef.current?.();
    schedulerRef.current?.request();
  }, [commandPreviewSpec, externalPreviewActive, previewSpec]);

  useEffect(() => {
    const prompt = promptRef.current;
    prompt?.setSpec(promptSpec);
    const canvas = canvasRef.current;
    if (canvas && prompt) {
      canvas.style.pointerEvents = prompt.blocksBoard ? "auto" : "none";
      if (!prompt.blocksBoard) syncPreviewPointerRef.current?.();
    }
    schedulerRef.current?.request();
  }, [promptSpec]);

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
        promptRef.current?.setViewport(width, height);
        const preview = previewRef.current;
        const canvasRect = canvasRef.current?.getBoundingClientRect();
        if (preview && canvasRect) {
          updateRulesPreview(preview, previewSpecRef.current, canvasRect, false, width, height);
          const backdrop = previewBackdropRef.current;
          if (backdrop) {
            updateRulesPreviewBackdrop(
              backdrop,
              previewSpecRef.current,
              width,
              height,
              themeRef.current.gameTheme.canvas.shadow,
            );
          }
        }
        const commandPreview = commandPreviewRef.current;
        if (commandPreview) {
          commandPreview.setViewport(width, height);
          commandPreview.setSpec(
            commandPreviewSpecRef.current && canvasRect
              ? toCommandPreviewSpec(commandPreviewSpecRef.current, canvasRect)
              : null,
          );
        }
        schedulerRef.current?.request();
      }
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const hitAt = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const rulesPreview = previewRef.current?.hitTest(x, y) ?? false;
      const commandPreview = commandPreviewRef.current?.hitTest(x, y) ?? false;
      return {
        stack: stackRef.current?.hitTest(x, y) ?? false,
        prompt: promptRef.current?.hitTest(x, y) ?? false,
        rulesPreview,
        preview: rulesPreview || commandPreview,
      };
    };
    const unbindPreviewScroll = bindPreviewScroll(
      window,
      (clientX, clientY) => {
        const rect = canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        return (
          (previewRef.current?.hitTest(x, y) ?? false) ||
          (stackRef.current?.hitTestRules(x, y) ?? false)
        );
      },
      (delta, mode, clientX, clientY) => {
        const rect = canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        if (previewRef.current?.hitTest(x, y)) {
          previewRef.current.scrollBy(delta, mode, x, y);
        } else {
          stackRef.current?.scrollRulesAt(x, y, delta, mode);
        }
        schedulerRef.current?.request();
      },
    );
    let pointerX = 0;
    let pointerY = 0;
    let hasPointer = false;
    const syncPointer = () => {
      if (!hasPointer) return;
      const rect = canvas.getBoundingClientRect();
      const x = pointerX - rect.left;
      const y = pointerY - rect.top;
      const rulesPreview = previewRef.current?.updateHover(x, y) ?? false;
      const commandPreview = commandPreviewRef.current?.updateHover(x, y) ?? false;
      const prompt = promptRef.current;
      canvas.style.pointerEvents =
        rulesPreview ||
        commandPreview ||
        prompt?.blocksBoard ||
        prompt?.hitTest(x, y) ||
        stackRef.current?.hitTest(x, y)
          ? "auto"
          : "none";
      schedulerRef.current?.request();
    };
    syncPreviewPointerRef.current = syncPointer;
    const onMove = (event: PointerEvent) => {
      hasPointer = event.pointerType !== "touch";
      if (!hasPointer) return;
      pointerX = event.clientX;
      pointerY = event.clientY;
      syncPointer();
    };
    const onWindowLeave = (event: PointerEvent) => {
      if (event.relatedTarget !== null) return;
      hasPointer = false;
      previewRef.current?.clearHover();
      commandPreviewRef.current?.clearHover();
      canvas.style.pointerEvents = promptRef.current?.blocksBoard ? "auto" : "none";
      schedulerRef.current?.request();
    };
    let dismissedPointerId: number | null = null;
    let dismissedClickPointerId: number | null = null;
    const onDown = (event: PointerEvent) => {
      if (!event.isTrusted) return;
      if (event.pointerType === "touch") hasPointer = false;
      dismissedClickPointerId = null;
      const hit = hitAt(event.clientX, event.clientY);
      const currentPreview = previewSpecRef.current;
      const stickyOpen =
        currentPreview?.sticky &&
        currentPreview.phase === "open" &&
        !currentPreview.suppressed &&
        Date.now() - stickyOpenedAtRef.current >= GHOST_CLICK_ARM_MS;

      if (!stickyOpen || hit.preview || hit.prompt) return;
      cbRef.current.onDismissPreview?.();
      schedulerRef.current?.request();
      if (
        !hasRulesPreviewBackdrop(currentPreview) &&
        (event.pointerType !== "touch" || hit.stack)
      ) {
        return;
      }
      dismissedPointerId = event.pointerId;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onUp = (event: PointerEvent) => {
      if (!event.isTrusted || event.pointerId !== dismissedPointerId) return;
      dismissedPointerId = null;
      dismissedClickPointerId = event.type === "pointerup" ? event.pointerId : null;
      event.preventDefault();
      event.stopImmediatePropagation();
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
      event.stopImmediatePropagation();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerout", onWindowLeave);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    window.addEventListener("click", onClick, true);
    const uninstallPointerRouting = installOverlayPointerRouting({
      canvas,
      hitTest: (clientX, clientY) => {
        const hit = hitAt(clientX, clientY);
        return hit.stack || hit.prompt || hit.preview;
      },
      onActivity: () => schedulerRef.current?.request(),
      onOverlayCancel: (pointerId) => stackRef.current?.cancelPointer(pointerId),
    });
    return () => {
      syncPreviewPointerRef.current = null;
      unbindPreviewScroll();
      uninstallPointerRouting();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerout", onWindowLeave);
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
    promptRef.current?.setTheme(theme);
    previewRef.current?.setTheme(theme);
    commandPreviewRef.current?.setTheme(theme);
    const backdrop = previewBackdropRef.current;
    const app = appRef.current;
    if (backdrop && app) {
      updateRulesPreviewBackdrop(
        backdrop,
        previewSpecRef.current,
        app.screen.width,
        app.screen.height,
        theme.gameTheme.canvas.shadow,
      );
    }
    schedulerRef.current?.request();
  }, [theme]);

  const hoveredStackCard = stackSpec.cards.find((card) => card.id === hoveredStackObjectId);
  const rulesPreviewOpen = previewSpec?.phase === "open" && !previewSpec.suppressed;
  const commandPreviewOpen = commandPreviewSpec?.phase === "open" && !commandPreviewSpec.suppressed;

  useKeybindings({
    ...(rulesPreviewOpen && previewSpec.actions.length > 0
      ? {
          "preview-prev-action": () => previewRef.current?.focusAction(-1),
          "preview-next-action": () => previewRef.current?.focusAction(1),
          "preview-activate-action": () => previewRef.current?.activateFocusedAction(),
        }
      : {}),
    ...(rulesPreviewOpen || commandPreviewOpen
      ? { "preview-dismiss": () => cbRef.current.onDismissPreview?.() }
      : {}),
    ...(rulesPreviewOpen
      ? { "flip-card": () => previewRef.current?.activatePrimaryTransform() }
      : hoveredStackObjectId && hoveredStackCard?.card.isDoubleFaced
        ? {
            "flip-card": () => {
              stackRef.current?.toggleFace(hoveredStackObjectId);
              schedulerRef.current?.request();
            },
          }
        : {}),
    ...(!externalPreviewActive && hoveredStackObjectId
      ? {
          "toggle-card-view": () => {
            stackRef.current?.toggleRulesView(hoveredStackObjectId);
            schedulerRef.current?.request();
          },
        }
      : {}),
  });

  useEffect(() => {
    if (!rulesPreviewOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (topModal() || event.defaultPrevented || event.isComposing) return;
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
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [rulesPreviewOpen]);

  return (
    <>
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
      <div
        ref={previewGlowRef}
        className={cn("pointer-events-none absolute left-0 top-0 z-10", ACTIONABLE_CARD_GLOW_CLASS)}
        style={{
          ...actionableCardGlowStyle(theme.gameTheme.cardRing),
          visibility: "hidden",
          willChange: "transform, width, height, opacity",
        }}
      />
    </>
  );
}
