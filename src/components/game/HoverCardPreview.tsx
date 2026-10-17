import { CardPreview } from "./CardPreview";
import type { CardPreviewController } from "@/hooks/useCardPreview";
import type { HandActionOption } from "@/stores/useGameUIStore";
import type { GamePreviewFlipBinding } from "@/hooks/useGamePreviewFlip";

interface HoverCardPreviewProps {
  preview: CardPreviewController;
  actions?: HandActionOption[];
  onSelectAction?: (action: HandActionOption) => void;
  suppressed?: boolean;
  skipEnterAnimation?: boolean;
  pinned?: boolean;
  onToggleView?: () => void;
  viewportRight?: number;
  viewportBounds?: DOMRect;
  slot?: HTMLElement | null;
  imageSize?: "normal" | "large";
  portalTarget?: HTMLElement | null;
  flip?: GamePreviewFlipBinding;
}

export function HoverCardPreview({
  preview,
  actions,
  onSelectAction,
  suppressed,
  skipEnterAnimation,
  pinned,
  onToggleView,
  viewportRight,
  viewportBounds,
  slot,
  imageSize,
  portalTarget,
  flip,
}: HoverCardPreviewProps) {
  if (!preview.hoveredCard || (pinned && preview.phase === "closing")) return null;
  if (pinned && !slot) return null;

  return (
    <CardPreview
      card={preview.hoveredCard}
      mouseX={preview.mousePos.x}
      mouseY={preview.mousePos.y}
      anchorRect={preview.anchorRect}
      placement={pinned ? "pinned" : preview.placement}
      viewportRight={viewportRight}
      viewportBounds={viewportBounds}
      phase={preview.phase === "closing" ? "closing" : "open"}
      suppressed={suppressed}
      skipEnterAnimation={skipEnterAnimation}
      showBackFace={preview.showBackFace}
      isSticky={preview.isSticky}
      actions={actions}
      onSelectAction={onSelectAction}
      onDismiss={preview.dismiss}
      onFlip={preview.flipCard}
      onNavigatePrevious={preview.canNavigatePrevious ? preview.navigatePrevious : undefined}
      onNavigateNext={preview.canNavigateNext ? preview.navigateNext : undefined}
      onToggleView={onToggleView}
      onMouseEnter={preview.onMouseEnterPreview}
      onMouseLeave={preview.onMouseLeavePreview}
      slot={slot}
      imageSize={imageSize}
      portalTarget={portalTarget}
      flipHandleRef={flip?.handleRef}
      flipClosed={flip?.closed}
      onPresentationReady={flip?.onReady}
    />
  );
}
