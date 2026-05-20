import { useCallback, useEffect, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";

import { getPlatformType } from "@/platform";
import { cn } from "@/lib/utils";

export function FullscreenToggle() {
  const [isFullscreen, setIsFullscreen] = useState(
    typeof document !== "undefined" && document.fullscreenElement !== null,
  );

  useEffect(() => {
    const sync = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void document.documentElement.requestFullscreen().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "f" && e.key !== "F") return;
      // Don't steal F while the user is typing into a field.
      const target = e.target as HTMLElement | null;
      if (target?.matches?.("input, textarea, [contenteditable='true']")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  if (getPlatformType() !== "web") return null;

  const Icon = isFullscreen ? Minimize2 : Maximize2;
  return (
    <button
      type="button"
      onClick={toggle}
      title={isFullscreen ? "Exit fullscreen (F)" : "Enter fullscreen (F)"}
      aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      className={cn(
        "absolute right-1.5 top-11 z-50 inline-flex h-8 w-8 items-center justify-center",
        "rounded-md border border-border/70 bg-card/95 text-muted-foreground backdrop-blur-sm",
        "shadow-[0_10px_30px_rgba(0,0,0,0.35)]",
        "transition hover:border-primary/60 hover:text-foreground hover:bg-accent/80",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
