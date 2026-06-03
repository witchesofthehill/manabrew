import { Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FocusModeButtonProps {
  focus: boolean;
  onToggle: (next: boolean) => void;
}

/**
 * Toggle between the standard bar+strip companion layout and a chrome-free
 * focus mode that hands the whole viewport to the player tiles — meant for
 * the "phone in the centre of the table" use case. Also drives the browser
 * Fullscreen API so the address bar / status bar disappear too on mobile.
 * Esc / system-gesture sync lives in `Companion.tsx`, not here — that
 * keeps the listener registered exactly once, owned by the focus-state
 * holder.
 */
export function FocusModeButton({ focus, onToggle }: FocusModeButtonProps) {
  const toggle = () => {
    const next = !focus;
    onToggle(next);
    if (next && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {
        /* user denied or unsupported — focus mode still works without fullscreen */
      });
    } else if (!next && document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {
        /* already exited */
      });
    }
  };

  return (
    <Button
      size="icon"
      variant="ghost"
      className="size-8"
      onClick={toggle}
      aria-label={focus ? "Exit focus mode" : "Focus mode"}
      title={focus ? "Exit focus mode (Esc)" : "Focus mode — hide controls"}
    >
      {focus ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
    </Button>
  );
}
