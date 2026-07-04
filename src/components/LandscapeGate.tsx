import { useEffect } from "react";
import { createPortal } from "react-dom";
import { RotateCw } from "lucide-react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useIsTouch } from "@/hooks/useBreakpoints";

/** Overlay for landscape-first views (game, draft): on small portrait touch
 *  screens it asks the user to rotate, and best-effort locks the orientation
 *  to landscape while mounted (only honoured by some browsers / fullscreen).
 *  Portaled to body above the modal/preview layers (z-9000/9999), which also
 *  portal to body and would otherwise render interactive on top of the gate. */
export function LandscapeGate() {
  const coarse = useIsTouch();
  const portrait = useMediaQuery("(orientation: portrait)");
  const small = useMediaQuery("(max-width: 1023px)");

  useEffect(() => {
    if (!coarse) return;
    const orientation = screen.orientation as
      | (ScreenOrientation & {
          lock?: (o: string) => Promise<void>;
          unlock?: () => void;
        })
      | undefined;
    orientation?.lock?.("landscape").catch(() => undefined);
    return () => orientation?.unlock?.();
  }, [coarse]);

  if (!coarse || !portrait || !small) return null;
  return createPortal(
    <div className="fixed inset-0 z-[10002] flex flex-col items-center justify-center gap-3 bg-background/95 p-6 text-center">
      <RotateCw className="h-10 w-10 animate-pulse text-muted-foreground" />
      <p className="text-lg font-semibold">Rotate your device</p>
      <p className="text-sm text-muted-foreground">This screen is designed for landscape play.</p>
    </div>,
    document.body,
  );
}
