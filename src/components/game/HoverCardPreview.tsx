import { CardPreview } from "./CardPreview";
import type { useCardPreview } from "@/hooks/useCardPreview";
import type { HandActionOption } from "@/stores/useGameUIStore";

interface HoverCardPreviewProps {
  preview: ReturnType<typeof useCardPreview>;
  /** Optional actions for interactive previews (game only). */
  actions?: HandActionOption[];
  /** Optional handler for selected actions (game only). */
  onSelectAction?: (action: HandActionOption) => void;
  pinned?: boolean;
  slot?: HTMLElement | null;
  imageSize?: "normal" | "large";
}

/**
 * Reusable wrapper that renders the CardPreview portal based on the state
 * from the useCardPreview hook. Consolidates duplicated rendering logic.
 */
export function HoverCardPreview({
  preview,
  actions,
  onSelectAction,
  pinned,
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
      showBackFace={preview.showBackFace}
      isSticky={preview.isSticky}
      actions={actions}
      onSelectAction={onSelectAction}
      onDismiss={preview.dismiss}
      onFlip={preview.flipCard}
      onMouseEnter={preview.onMouseEnterPreview}
      onMouseLeave={preview.onMouseLeavePreview}
      slot={slot}
      imageSize={imageSize}
    />
  );
}
