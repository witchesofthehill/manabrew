import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { CARD_LIVE_PULSE, type CardLiveHighlightLayers } from "@/lib/cardLiveHighlights";
import { recordCardRasterCopy } from "@/lib/cardRenderTypes";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const subscribeMotion = (notify: () => void) => {
  reducedMotion.addEventListener("change", notify);
  return () => reducedMotion.removeEventListener("change", notify);
};
const motionSnapshot = () => reducedMotion.matches;

interface CardLiveHighlightOverlayProps {
  enabled: boolean;
  layers?: CardLiveHighlightLayers;
}

export function CardLiveHighlightOverlay({ enabled, layers }: CardLiveHighlightOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const animations = usePreferencesStore((state) => state.inGameAnimations);
  const reduced = useSyncExternalStore(subscribeMotion, motionSnapshot);
  const active = enabled && animations && !reduced && !!layers?.regions.length;

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const surface = surfaceRef.current;
    const host = overlay?.parentElement;
    if (!active || !layers || !overlay || !surface || !host) return;

    const inkCanvases: HTMLCanvasElement[] = [];
    // Every native paper patch must be below every transparent ink region.
    for (const kind of ["paper", "ink"] as const) {
      for (const region of layers.regions) {
        const source = region[kind];
        const canvas = document.createElement("canvas");
        canvas.width = source.width;
        canvas.height = source.height;
        canvas.style.left = `${(region.x / layers.width) * 100}%`;
        canvas.style.top = `${(region.y / layers.height) * 100}%`;
        canvas.style.width = `${(source.width / layers.width) * 100}%`;
        canvas.style.height = `${(source.height / layers.height) * 100}%`;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Card highlighting requires a 2D canvas context");
        context.drawImage(source, 0, 0);
        recordCardRasterCopy(source.width, source.height, "dom");
        surface.appendChild(canvas);
        if (kind === "ink") inkCanvases.push(canvas);
      }
    }
    const pulses = inkCanvases.map((canvas) => {
      const pulse = canvas.animate(
        [
          { transform: `translateY(0%) scale(${CARD_LIVE_PULSE.minScale})` },
          {
            transform: `translateY(${(-layers.floatPx / canvas.height) * 100}%) scale(${CARD_LIVE_PULSE.maxScale})`,
          },
        ],
        {
          duration: CARD_LIVE_PULSE.halfDurationS * 1000,
          direction: "alternate",
          iterations: Infinity,
          easing: "cubic-bezier(0.37, 0, 0.63, 1)",
        },
      );
      pulse.pause();
      return pulse;
    });
    const resize = () => {
      const scale = Math.min(host.clientWidth / layers.width, host.clientHeight / layers.height);
      surface.style.width = `${layers.width * scale}px`;
      surface.style.height = `${layers.height * scale}px`;
    };
    const sizes = new ResizeObserver(resize);
    sizes.observe(host);
    resize();
    let intersecting = false;
    const refresh = () => {
      const visible =
        intersecting &&
        !document.hidden &&
        host.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      overlay.style.visibility = visible ? "visible" : "hidden";
      for (const pulse of pulses) {
        if (visible) pulse.play();
        else pulse.pause();
      }
    };
    const intersection = new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting;
      refresh();
    });
    const mutations = new MutationObserver(refresh);
    for (let ancestor: HTMLElement | null = host; ancestor; ancestor = ancestor.parentElement) {
      mutations.observe(ancestor, {
        attributes: true,
        attributeFilter: ["style", "class", "hidden"],
      });
    }
    const transitionFinished = (event: Event) => {
      if (event.target instanceof HTMLElement && event.target.contains(host)) refresh();
    };
    intersection.observe(host);
    document.addEventListener("visibilitychange", refresh);
    document.addEventListener("transitionend", transitionFinished, true);
    document.addEventListener("animationend", transitionFinished, true);
    refresh();
    return () => {
      sizes.disconnect();
      intersection.disconnect();
      mutations.disconnect();
      document.removeEventListener("visibilitychange", refresh);
      document.removeEventListener("transitionend", transitionFinished, true);
      document.removeEventListener("animationend", transitionFinished, true);
      for (const pulse of pulses) pulse.cancel();
      surface.replaceChildren();
    };
  }, [active, layers]);

  return active ? (
    <div
      ref={overlayRef}
      aria-hidden="true"
      className="card-live-highlight-overlay"
      data-card-live-highlight="true"
    >
      <div ref={surfaceRef} className="card-live-highlight-surface" />
    </div>
  ) : null;
}
