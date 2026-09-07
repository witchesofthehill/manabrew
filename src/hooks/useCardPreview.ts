import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { CardDto } from "@/protocol/game";
import { CardPreviewMachine, type PreviewPointerInput } from "@/lib/cardPreview";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

const ignorePreviewUpdates = () => () => undefined;

export interface HoverOptions {
  useAnchor?: boolean;
  placement?: "auto" | "top-center" | "pinned";
  anchorOverride?: DOMRect;
  useDelay?: boolean;
  trigger?: PreviewPointerInput;
  ignoreTriggerPreference?: boolean;
}

export function useCardPreview(
  dismissDeps: unknown[] = [],
  hookOptions: { subscribe?: boolean; useTriggerPreference?: boolean } = {},
) {
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
  const flipCard = useCallback(() => machine.flip(), [machine]);

  const showSticky = useCallback(
    (card: CardDto, x?: number, y?: number, anchor?: HTMLElement | DOMRect) => {
      machine.stick(card, {
        pointer: x != null && y != null ? { x, y } : undefined,
        anchorRect:
          anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : (anchor ?? null),
      });
    },
    [machine],
  );

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
    dismiss,
    flipCard,
    handleMouseEnter,
    handleMouseLeave,
    onMouseEnterPreview,
    onMouseLeavePreview,
    showSticky,
  };
}
