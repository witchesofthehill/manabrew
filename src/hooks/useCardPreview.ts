import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { CardDto } from "@/protocol/game";
import {
  CardPreviewMachine,
  type PreviewFlipOptions,
  type PreviewPointerInput,
  type PreviewSnapshot,
} from "@/lib/cardPreview";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { MODAL_OPEN_EVENT, topModal } from "@/lib/modalStack";
import { isCardPreviewTarget } from "@/lib/cardPreviewEvents";

const ignorePreviewUpdates = () => () => undefined;

export interface HoverOptions {
  useAnchor?: boolean;
  placement?: "auto" | "top-center" | "pinned";
  anchorOverride?: DOMRect;
  useDelay?: boolean;
  trigger?: PreviewPointerInput;
  ignoreTriggerPreference?: boolean;
}
export interface StickyPreviewOptions {
  allowOverModal?: boolean;
}

export interface CardPreviewController extends Omit<PreviewSnapshot, "card" | "sticky"> {
  hoveredCard: PreviewSnapshot["card"];
  isSticky: boolean;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => PreviewSnapshot;
  dismiss: () => void;
  flipCard: (options?: PreviewFlipOptions) => void;
  setSequence: (cards: readonly CardDto[]) => void;
  navigatePrevious: () => void;
  navigateNext: () => void;
  handleMouseEnter: (card: CardDto, event?: React.MouseEvent, options?: HoverOptions) => void;
  handleMouseLeave: () => void;
  onMouseEnterPreview: () => void;
  onMouseLeavePreview: () => void;
  showSticky: (
    card: CardDto,
    x?: number,
    y?: number,
    anchor?: HTMLElement | DOMRect,
    options?: StickyPreviewOptions,
  ) => void;
}

export function useCardPreview(
  dismissDeps: unknown[] = [],
  hookOptions: { subscribe?: boolean; useTriggerPreference?: boolean } = {},
): CardPreviewController {
  const machineRef = useRef<CardPreviewMachine | null>(null);
  machineRef.current ??= new CardPreviewMachine();
  const machine = machineRef.current;

  const snapshot = useSyncExternalStore(
    hookOptions.subscribe === false ? ignorePreviewUpdates : machine.subscribe,
    machine.getSnapshot,
  );

  const cardPreviewMode = usePreferencesStore((s) => s.cardPreviewMode);
  const cardHoverDelayMs = usePreferencesStore((s) => s.cardHoverDelayMs);
  const modeRef = useRef(cardPreviewMode);
  modeRef.current = cardPreviewMode;
  const delayRef = useRef(cardHoverDelayMs);
  delayRef.current = cardHoverDelayMs;

  const handleMouseEnter = useCallback(
    (card: CardDto, e?: React.MouseEvent, options: HoverOptions = {}) => {
      if (e && isCardPreviewTarget(e.target)) return;
      if (hookOptions.useTriggerPreference && topModal()) return;
      const trigger = options.trigger ?? e;
      if (trigger && trigger.buttons !== 0) {
        machine.dismiss();
        return;
      }
      if (
        hookOptions.useTriggerPreference &&
        modeRef.current === "right-click" &&
        !options.ignoreTriggerPreference
      )
        return;
      machine.hoverStart(card, {
        pointer: e ? { x: e.clientX, y: e.clientY } : undefined,
        anchorRect:
          options.anchorOverride ??
          (options.useAnchor && e
            ? (e.currentTarget as HTMLElement).getBoundingClientRect()
            : null),
        placement: options.placement,
        delayMs: options.useDelay ? delayRef.current : 0,
      });
    },
    [hookOptions.useTriggerPreference, machine],
  );

  const handleMouseLeave = useCallback(() => machine.hoverEnd(), [machine]);
  const onMouseEnterPreview = useCallback(() => machine.pointerEnterPreview(), [machine]);
  const onMouseLeavePreview = useCallback(() => machine.pointerLeavePreview(), [machine]);
  const dismiss = useCallback(() => machine.dismiss(), [machine]);
  const flipCard = useCallback((options?: PreviewFlipOptions) => machine.flip(options), [machine]);
  const setSequence = useCallback(
    (cards: readonly CardDto[]) => machine.setSequence(cards),
    [machine],
  );
  const navigatePrevious = useCallback(() => machine.navigate(-1), [machine]);
  const navigateNext = useCallback(() => machine.navigate(1), [machine]);

  const showSticky = useCallback(
    (
      card: CardDto,
      x?: number,
      y?: number,
      anchor?: HTMLElement | DOMRect,
      options: StickyPreviewOptions = {},
    ) => {
      if (hookOptions.useTriggerPreference && topModal() && !options.allowOverModal) return;
      machine.stick(card, {
        pointer: x != null && y != null ? { x, y } : undefined,
        anchorRect:
          anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : (anchor ?? null),
      });
    },
    [hookOptions.useTriggerPreference, machine],
  );

  useEffect(() => {
    window.addEventListener(MODAL_OPEN_EVENT, dismiss);
    return () => window.removeEventListener(MODAL_OPEN_EVENT, dismiss);
  }, [dismiss]);

  const lastDepsRef = useRef(dismissDeps);
  useEffect(() => {
    const prev = lastDepsRef.current;
    const changed =
      dismissDeps.length !== prev.length || dismissDeps.some((dep, i) => dep !== prev[i]);
    if (changed) {
      lastDepsRef.current = dismissDeps;
      machine.dismiss();
    }
  });

  useEffect(() => () => machine.destroy(), [machine]);

  return {
    subscribe: machine.subscribe,
    getSnapshot: machine.getSnapshot,
    hoveredCard: snapshot.card,
    phase: snapshot.phase,
    mousePos: snapshot.mousePos,
    anchorRect: snapshot.anchorRect,
    placement: snapshot.placement,
    showBackFace: snapshot.showBackFace,
    isSticky: snapshot.sticky,
    canNavigatePrevious: snapshot.canNavigatePrevious,
    canNavigateNext: snapshot.canNavigateNext,
    dismiss,
    flipCard,
    setSequence,
    navigatePrevious,
    navigateNext,
    handleMouseEnter,
    handleMouseLeave,
    onMouseEnterPreview,
    onMouseLeavePreview,
    showSticky,
  };
}
