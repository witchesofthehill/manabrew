import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HoverCardPreview } from "@/components/game/HoverCardPreview";
import { deriveCardRailState } from "@/components/game/cardRailState";
import type { CardPreviewController } from "@/hooks/useCardPreview";
import { useKeybindings } from "@/hooks/useKeybindings";
import type { PreviewSnapshot } from "@/lib/cardPreview";
import { CardPreviewOverlayCanvas } from "@/pixi/CardPreviewOverlayCanvas";
import type { BoardOverlayPreviewSpec } from "@/pixi/BoardOverlayCanvas";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import type { HandActionOption } from "@/stores/useGameUIStore";

interface Props {
  preview: CardPreviewController;
  actions?: HandActionOption[];
  onSelectAction?: (action: HandActionOption) => void;
  suppressed?: boolean;
  viewportRight?: number;
  portalTarget?: HTMLElement | null;
}
const NO_ACTIONS: HandActionOption[] = [];

export function CardHoverPreview({
  preview,
  actions = NO_ACTIONS,
  onSelectAction,
  suppressed = false,
  viewportRight,
  portalTarget,
}: Props) {
  const style = usePreferencesStore((state) => state.inGameCardPreviewStyle);
  const scope = useRef<HTMLDivElement>(null);
  const [switchedSnapshot, setSwitchedSnapshot] = useState<PreviewSnapshot | null>(null);
  const { getSnapshot } = preview;
  const toggleView = useCallback(() => {
    const snapshot = getSnapshot();
    if (!snapshot.card) return;
    setSwitchedSnapshot(snapshot);
    const preferences = usePreferencesStore.getState();
    preferences.setInGameCardPreviewStyle(
      preferences.inGameCardPreviewStyle === "printed" ? "rules" : "printed",
    );
  }, [getSnapshot]);
  const active = preview.phase === "open" && !suppressed && !!preview.hoveredCard;
  useKeybindings(
    active ? { "toggle-card-view": toggleView } : {},
    portalTarget ? scope : undefined,
  );
  if (!preview.hoveredCard) return null;
  const skipEnterAnimation = active && switchedSnapshot === getSnapshot();
  const rulesPreview: BoardOverlayPreviewSpec = {
    card: preview.hoveredCard,
    phase: preview.phase === "closing" ? "closing" : "open",
    sticky: preview.isSticky,
    placement: preview.placement,
    showBackFace: preview.showBackFace,
    suppressed,
    skipEnterAnimation,
    actions,
    reserveSidePanel: actions.length > 0 || deriveCardRailState(preview.hoveredCard) != null,
    mousePos: preview.mousePos,
    anchorRect: preview.anchorRect,
    viewportRight,
  };
  return (
    <>
      {createPortal(
        <div ref={scope} className="pointer-events-none fixed inset-0 z-[10001]">
          {style === "rules" && (
            <CardPreviewOverlayCanvas
              previewSpec={rulesPreview}
              externalPreviewActive={active}
              onPreviewPointerEnter={preview.onMouseEnterPreview}
              onPreviewPointerLeave={preview.onMouseLeavePreview}
              onSelectPreviewAction={onSelectAction}
              onDismissPreview={preview.dismiss}
              onFlipPreview={preview.flipCard}
              onTogglePreviewView={toggleView}
            />
          )}
        </div>,
        portalTarget ?? document.body,
      )}
      {style === "printed" && (
        <HoverCardPreview
          preview={preview}
          actions={actions}
          onSelectAction={onSelectAction}
          suppressed={suppressed}
          skipEnterAnimation={skipEnterAnimation}
          onToggleView={toggleView}
          viewportRight={viewportRight}
          portalTarget={portalTarget}
        />
      )}
    </>
  );
}
