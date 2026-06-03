import { useEffect, useState } from "react";
import { Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FocusExitButtonProps {
  onExit: () => void;
}

const AUTO_DIM_AFTER_MS = 4000;

/**
 * Floating "exit focus mode" affordance for touch screens. Sits in a
 * fixed corner (with safe-area-inset padding for notches) at full opacity
 * for the first few seconds after entering focus, then dims to a small
 * always-visible chip. Tapping anywhere on the floating chip brings it
 * back to full opacity for another window, so the user can find it on
 * a phone-on-table setup without leaning over to look closely.
 */
export function FocusExitButton({ onExit }: FocusExitButtonProps) {
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

  const wake = () => {
    setBright(true);
  };

  return (
    <div
      onPointerEnter={wake}
      onPointerDown={wake}
      onTouchStart={wake}
      className={cn(
        "pointer-events-auto fixed right-[calc(env(safe-area-inset-right)+12px)] top-[calc(env(safe-area-inset-top)+12px)] z-[60] flex items-center gap-2 rounded-full border border-border bg-card/90 px-2 py-1 shadow-xl backdrop-blur transition-opacity",
        bright ? "opacity-100" : "opacity-40",
      )}
    >
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
