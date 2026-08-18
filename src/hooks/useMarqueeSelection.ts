import { useRef, useState, useCallback } from "react";

export interface Marquee {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  additive: boolean;
}

export interface MarqueeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface UseMarqueeOptions {
  /** Called when marquee selection completes. Receives the selection rect in container-local coords, whether shift was held, and the current set of already-selected ids to merge with. */
  onMarqueeComplete?: (rect: MarqueeRect, additive: boolean, currentSelected: Set<string>) => void;
  /** Minimum width/height in px before a marquee is considered intentional (avoids accidental tiny selections). Default 4. */
  minSize?: number;
  externalContainerRef?: React.RefObject<HTMLDivElement | null>;
}

export function useMarquee({
  onMarqueeComplete,
  minSize = 4,
  externalContainerRef,
}: UseMarqueeOptions = {}) {
  const internalRef = useRef<HTMLDivElement>(null);
  const containerRef = externalContainerRef ?? internalRef;
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const marqueeRef = useRef<Marquee | null>(null);

  const handleContainerMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;

      const el = containerRef.current;
      if (!el) return;

      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const startX = e.clientX - rect.left;
      const startY = e.clientY - rect.top;
      const additive = e.shiftKey;

      const initial: Marquee = { startX, startY, currentX: startX, currentY: startY, additive };
      marqueeRef.current = initial;
      setMarquee(initial);

      const handleMouseMove = (me: MouseEvent) => {
        const currentX = Math.max(0, Math.min(el.clientWidth, me.clientX - rect.left));
        const currentY = Math.max(0, Math.min(el.clientHeight, me.clientY - rect.top));
        const updated = { ...marqueeRef.current!, currentX, currentY };
        marqueeRef.current = updated;
        setMarquee(updated);
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);

        const m = marqueeRef.current;
        marqueeRef.current = null;
        setMarquee(null);

        if (!m) return;
        const selX = Math.min(m.startX, m.currentX);
        const selY = Math.min(m.startY, m.currentY);
        const selW = Math.abs(m.currentX - m.startX);
        const selH = Math.abs(m.currentY - m.startY);

        if (selW > minSize || selH > minSize) {
          onMarqueeComplete?.(
            { left: selX, top: selY, width: selW, height: selH },
            m.additive,
            new Set(),
          );
        }
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [containerRef, onMarqueeComplete, minSize],
  );

  const marqueeRect: MarqueeRect | null = marquee
    ? {
        left: Math.min(marquee.startX, marquee.currentX),
        top: Math.min(marquee.startY, marquee.currentY),
        width: Math.abs(marquee.currentX - marquee.startX),
        height: Math.abs(marquee.currentY - marquee.startY),
      }
    : null;

  return {
    containerRef,
    marquee,
    marqueeRect,
    handleContainerMouseDown,
  };
}
