import { useEffect } from "react";
import { RotateCw } from "lucide-react";
import { useMediaQuery } from "@/hooks/useMediaQuery";

/** Overlay for landscape-first views (game, draft): on small portrait touch
 *  screens it asks the user to rotate, and best-effort locks the orientation
 *  to landscape while mounted (only honoured by some browsers / fullscreen). */
export function LandscapeGate() {
  const coarse = useMediaQuery("(pointer: coarse)");
  const portrait = useMediaQuery("(orientation: portrait)");
  const small = useMediaQuery("(max-width: 1023px)");

  useEffect(() => {
    if (!coarse) return;
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (o: string) => Promise<void>;
      unlock?: () => void;
    };
    orientation.lock?.("landscape").catch(() => undefined);
    return () => orientation.unlock?.();
  }, [coarse]);

  if (!coarse || !portrait || !small) return null;
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-background/95 p-6 text-center">
      <RotateCw className="h-10 w-10 animate-pulse text-muted-foreground" />
      <p className="text-lg font-semibold">Rotate your device</p>
      <p className="text-sm text-muted-foreground">This screen is designed for landscape play.</p>
    </div>
  );
}
