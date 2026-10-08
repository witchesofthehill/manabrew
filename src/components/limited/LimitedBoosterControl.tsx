import { useCallback, useEffect, useId, useImperativeHandle, useRef } from "react";
import type { CSSProperties, ReactNode, Ref, RefObject } from "react";
import { Container } from "pixi.js";
import type { BoosterTearDirection } from "@/pixi/limited/LimitedBoosterReveal";
import { LimitedBoosterDragEffects } from "@/pixi/limited/LimitedBoosterDragEffects";
import { acquireLimitedRenderer } from "@/pixi/limited/LimitedRenderer";
import type { LimitedPane } from "@/pixi/limited/LimitedRenderer";
import { LimitedBoosterGuide } from "@/components/limited/LimitedBoosterGuide";
import { useLimitedBoosterGesture } from "@/components/limited/useLimitedBoosterGesture";
import { subscribeTheme } from "@/hooks/useTheme";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";

export interface LimitedBoosterControlHandle {
  reset: () => void;
  focus: () => void;
  open: (ids: string[], direction?: BoosterTearDirection) => void;
  dragging: () => boolean;
}
interface LimitedBoosterControlProps {
  targets: readonly { id: string; label: string; style: CSSProperties; className?: string }[];
  host?: RefObject<HTMLDivElement | null>;
  effectsHost: RefObject<HTMLElement | null>;
  buttons: RefObject<Map<string, HTMLButtonElement>>;
  disabled: boolean;
  onOpen: (ids: string[], direction?: BoosterTearDirection) => void;
  onTear: (id: string, progress: number, direction?: BoosterTearDirection) => void;
  onHover?: (id: string, active: boolean) => void;
  label: string;
  className?: string;
  style?: CSSProperties;
  children?: (selectedIds: readonly string[]) => ReactNode;
  ref?: Ref<LimitedBoosterControlHandle>;
}

export function LimitedBoosterControl({
  targets,
  host,
  effectsHost,
  buttons,
  disabled,
  onOpen,
  onTear,
  onHover,
  label,
  className,
  style,
  children,
  ref,
}: LimitedBoosterControlProps) {
  const effects = useRef<LimitedBoosterDragEffects | null>(null);
  const committed = useRef(false);
  const progress = useRef(new Map<string, number>());
  const instructionsId = useId();
  const finishOpen = useCallback(
    (ids: string[], direction?: BoosterTearDirection) => {
      if (disabled || committed.current) return;
      committed.current = true;
      haptic("confirm");
      onOpen(ids, direction);
    },
    [disabled, onOpen],
  );
  const tear = useCallback(
    (id: string, amount: number, direction?: BoosterTearDirection) => {
      progress.current.set(id, amount);
      onTear(id, amount, direction);
    },
    [onTear],
  );
  const { gesture, reset, selectedIds, handlers } = useLimitedBoosterGesture(
    buttons,
    disabled,
    finishOpen,
    tear,
    effects,
  );
  const open = useCallback(
    (ids: string[], direction?: BoosterTearDirection) => {
      if (disabled || committed.current) return;
      reset(false);
      finishOpen(ids, direction);
    },
    [disabled, reset, finishOpen],
  );
  useImperativeHandle(
    ref,
    () => ({
      reset,
      focus: () => [...buttons.current.values()].at(-1)?.focus(),
      open,
      dragging: () => gesture.current !== null,
    }),
    [buttons, gesture, reset, open],
  );
  useEffect(() => {
    if (disabled) reset();
    else committed.current = false;
  }, [disabled, reset]);
  useEffect(() => {
    const element = effectsHost.current;
    if (!element) return;
    const root = new Container({ eventMode: "none" });
    const feedback = new LimitedBoosterDragEffects(() => renderer.request());
    effects.current = feedback;
    const pane: LimitedPane = {
      host: element,
      root,
      layer: "decoration",
      frame: () => {
        feedback.frame();
        return false;
      },
      abort: reset,
    };
    const renderer = acquireLimitedRenderer(pane);
    renderer.addOverlay(feedback.root, "opening");
    const unsubscribe = subscribeTheme(() => {
      reset();
      feedback.setTheme();
      renderer.request();
    });
    const resize = () => reset();
    window.addEventListener("resize", resize);
    void renderer.ready.then(renderer.request);
    return () => {
      unsubscribe();
      window.removeEventListener("resize", resize);
      reset();
      effects.current = null;
      feedback.destroy();
      renderer.release(pane);
      root.destroy({ children: true });
    };
  }, [effectsHost, reset]);
  return (
    <>
      <div
        ref={host}
        role="group"
        aria-label={label}
        {...handlers}
        className={className}
        style={style}
      >
        {targets.map((target) => (
          <button
            key={target.id}
            ref={(button) => {
              if (button) buttons.current.set(target.id, button);
              else buttons.current.delete(target.id);
            }}
            type="button"
            data-limited-pack-id={target.id}
            disabled={disabled}
            aria-label={target.label}
            aria-describedby={instructionsId}
            aria-pressed={selectedIds.includes(target.id)}
            onClick={(event) => open(event.shiftKey ? targets.map(({ id }) => id) : [target.id])}
            onKeyDown={(event) => {
              if (event.key === "Home" || event.key === "Escape") {
                event.preventDefault();
                reset();
              } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                event.preventDefault();
                const direction = event.key === "ArrowLeft" ? "left" : "right";
                const amount = (progress.current.get(target.id) ?? 0) + 0.1;
                if (amount >= 0.99) open([target.id], direction);
                else tear(target.id, amount, direction);
              }
            }}
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse") onHover?.(target.id, true);
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse") onHover?.(target.id, false);
            }}
            onFocus={() => onHover?.(target.id, true)}
            onBlur={() => onHover?.(target.id, false)}
            className={cn(
              "group absolute cursor-grab touch-none rounded-lg active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary disabled:cursor-wait",
              target.className,
            )}
            style={target.style}
          >
            <LimitedBoosterGuide />
          </button>
        ))}
      </div>
      <p id={instructionsId} className="sr-only">
        Drag to tear, then release to open. Tap, Enter or Space opens the focused booster. Arrow
        keys tear gradually. Home or Escape resets an unfinished tear. Shift-click opens all
        boosters.
      </p>
      {children?.(selectedIds)}
    </>
  );
}
