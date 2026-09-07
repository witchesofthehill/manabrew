import { CardPreview } from "./CardPreview";
import type { useCardPreview } from "@/hooks/useCardPreview";
import type { HandActionOption } from "@/stores/useGameUIStore";

interface HoverCardPreviewProps {
  preview: ReturnType<typeof useCardPreview>;
  actions?: HandActionOption[];
  onSelectAction?: (action: HandActionOption) => void;
  suppressed?: boolean;
  skipEnterAnimation?: boolean;
  pinned?: boolean;
  onToggleView?: () => void;
  slot?: HTMLElement | null;
  imageSize?: "normal" | "large";
}

export function HoverCardPreview({
  preview,
  actions,
  onSelectAction,
  suppressed,
  skipEnterAnimation,
  pinned,
  onToggleView,
  slot,
  imageSize,
}: HoverCardPreviewProps) {
  if (!preview.hoveredCard) return null;
  if (pinned && !slot) return null;

  return (
    <CardPreview
      card={preview.hoveredCard}
      mouseX={preview.mousePos.x}
      mouseY={preview.mousePos.y}
      anchorRect={preview.anchorRect}
      placement={pinned ? "pinned" : preview.placement}
      phase={preview.phase === "closing" ? "closing" : "open"}
      suppressed={suppressed}
      skipEnterAnimation={skipEnterAnimation}
      showBackFace={preview.showBackFace}
      isSticky={preview.isSticky}
      actions={actions}
      onSelectAction={onSelectAction}
      onDismiss={preview.dismiss}
      onFlip={preview.flipCard}
      onToggleView={onToggleView}
      onMouseEnter={preview.onMouseEnterPreview}
      onMouseLeave={preview.onMouseLeavePreview}
      slot={slot}
      imageSize={imageSize}
    />
  );
}
