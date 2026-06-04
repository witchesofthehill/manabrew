import { useEffect, useState } from "react";
import { Eye, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FocusExitButtonProps {
  onExit: () => void;
  onShowChrome: () => void;
}

const AUTO_DIM_AFTER_MS = 4000;

/**
 * Floating focus-mode control cluster for touch devices. Pinned to the
 * top-right inside the safe-area-inset; full opacity for the first few
 * seconds, then dims to a small always-tappable chip. Houses two
 * actions: peek the bar + phase strip back in (without leaving focus
 * mode) and exit focus entirely. Only mounted while focus is on AND
 * the chrome is hidden — the hide-peek control lives in the bar
 * itself once chrome is visible.
 */
export function FocusExitButton({ onExit, onShowChrome }: FocusExitButtonProps) {
  const [bright, setBright] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setBright(false), AUTO_DIM_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  const handleExit = () => {
    onExit();
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {
        /* already exited */
      });
    }
  };

  const wake = () => setBright(true);

  return (
    <div
      onPointerEnter={wake}
      onPointerDown={wake}
      onTouchStart={wake}
      className={cn(
        "pointer-events-auto fixed right-[calc(env(safe-area-inset-right)+12px)] top-[calc(env(safe-area-inset-top)+12px)] z-[60] flex items-center gap-1 rounded-full border border-border bg-card/90 px-1 py-1 shadow-xl backdrop-blur transition-opacity",
        bright ? "opacity-100" : "opacity-40",
      )}
    >
      <Button
        size="sm"
        variant="ghost"
        onClick={onShowChrome}
        className="h-9 gap-1 rounded-full px-3 text-xs font-semibold"
        aria-label="Show controls"
        title="Peek bar and phase strip"
      >
        <Eye className="size-4" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={handleExit}
        className="h-9 gap-1 rounded-full px-3 text-xs font-semibold"
        aria-label="Exit focus mode"
        title="Exit focus mode"
      >
        <Minimize2 className="size-4" />
        <span>Exit</span>
      </Button>
    </div>
  );
}
