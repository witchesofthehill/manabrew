import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { boardBackgroundDarken, boardBackgroundUrl } from "@/pixi/board/boardBackgrounds";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { cn } from "@/lib/utils";
import { CardPreviewOwnershipContext } from "@/hooks/useCardPreview";
import { setAnimationsEnabled } from "@/pixi/effects/enabled";

interface LimitedTableSurfaceProps {
  children: ReactNode;
  backgroundId?: string | null;
  className?: string;
}

export function LimitedTableSurface({
  children,
  backgroundId,
  className,
}: LimitedTableSurfaceProps) {
  const [previewOwners] = useState(() => new Set<() => void>());
  const personalBackground = usePreferencesStore((state) => state.boardBackgroundId);
  const inGameAnimations = usePreferencesStore((state) => state.inGameAnimations);
  useEffect(() => {
    setAnimationsEnabled(inGameAnimations);
  }, [inGameAnimations]);
  const selectedBackground = backgroundId ?? personalBackground;
  const backgroundUrl = boardBackgroundUrl(selectedBackground);
  const darken = boardBackgroundDarken(selectedBackground);

  return (
    <div className="font-game game-touch-surface relative isolate flex h-full min-h-0 flex-col overflow-hidden bg-canvas-background pb-[var(--safe-area-inset-bottom)] pl-[var(--safe-area-inset-left)] pr-[var(--safe-area-inset-right)]">
      {backgroundUrl && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: `url(${backgroundUrl})`,
            filter: `brightness(${1 - darken})`,
          }}
        />
      )}
      <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", className)}>
        <CardPreviewOwnershipContext.Provider value={previewOwners}>
          {children}
        </CardPreviewOwnershipContext.Provider>
      </div>
    </div>
  );
}
