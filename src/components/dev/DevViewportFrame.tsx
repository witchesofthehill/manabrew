import { useEffect, useRef, useState, type ReactNode } from "react";

import { useGameDevStore } from "@/stores/useGameDevStore";

import { getDevViewportOption } from "./devViewportPresets";

interface DevViewportFrameProps {
  children: ReactNode;
}

interface FrameBounds {
  width: number;
  height: number;
}

export function DevViewportFrame({ children }: DevViewportFrameProps) {
  const preset = useGameDevStore((s) => s.debugViewportPreset);
  const frameRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<FrameBounds>({ width: 0, height: 0 });
  const option = getDevViewportOption(preset);

  useEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setBounds({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (option.width == null || option.height == null) {
    return (
      <div ref={frameRef} className="flex min-h-0 flex-1 overflow-visible">
        {children}
      </div>
    );
  }

  const availableWidth = Math.max(1, bounds.width - 16);
  const availableHeight = Math.max(1, bounds.height - 16);
  const scale = Math.min(1, availableWidth / option.width, availableHeight / option.height);

  return (
    <div ref={frameRef} className="relative min-h-0 flex-1 overflow-hidden bg-background/80">
      <div
        className="absolute left-1/2 top-1/2 flex overflow-hidden rounded-lg border border-primary/60 bg-background shadow-[0_20px_60px_rgba(0,0,0,0.45)]"
        style={{
          width: option.width,
          height: option.height,
          transform: `translate(-50%, -50%) scale(${scale})`,
        }}
      >
        {children}
      </div>
      <span className="pointer-events-none absolute bottom-2 left-2 rounded-md border border-border/70 bg-card/95 px-2 py-1 font-mono text-[10px] text-muted-foreground shadow-sm">
        {option.label} · {option.width}×{option.height} · {Math.round(scale * 100)}%
      </span>
    </div>
  );
}
