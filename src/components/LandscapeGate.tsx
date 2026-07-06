import { useEffect } from "react";
import { createPortal } from "react-dom";
import { RotateCw } from "lucide-react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useIsTouch } from "@/hooks/useBreakpoints";
import { LANDSCAPE_GATE_MAX_WIDTH_QUERY, PORTRAIT_QUERY } from "@/lib/responsive";

export function LandscapeGate() {
  const coarse = useIsTouch();
  const portrait = useMediaQuery(PORTRAIT_QUERY);
  const small = useMediaQuery(LANDSCAPE_GATE_MAX_WIDTH_QUERY);

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
