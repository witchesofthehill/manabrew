import type { CardDto } from "@/protocol/game";
import { GeneratedCardImage } from "@/components/game/GeneratedCardImage";
import { attachmentKind, type AttachmentReference } from "@/components/game/attachmentPanel";

export function AttachmentMiniature({
  reference,
  onHighlight,
  onHover,
  onRightClick,
  onLeave,
  onContextMenu,
}: {
  reference: AttachmentReference;
  onHighlight: (reference: AttachmentReference) => void;
  onHover: (card: CardDto, anchor: DOMRect) => void;
  onRightClick?: (card: CardDto, anchor: DOMRect) => void;
  onLeave: (nextTarget: EventTarget | null) => void;
  onContextMenu: (event: React.MouseEvent) => void;
}) {
  const targetLabel = reference.target?.identity.name ?? "Target unavailable";
  const equipment = attachmentKind(reference.card) === "equipment";
  const unattachedLabel = equipment ? "Unequipped" : "Unattached";
  const status = reference.card.attachedTo
    ? `${equipment ? "Equipped" : "Attached"} to ${targetLabel}`
    : unattachedLabel;
  const phasedOut = reference.card.phasedOut || reference.target?.phasedOut;
  return (
    <button
      type="button"
      data-attachment-proxy={reference.card.id}
      aria-label={`${reference.card.identity.name}. ${status}.${phasedOut ? " Phased out." : ""} Visual reference.`}
      className="relative w-24 shrink-0 rounded border border-border text-left opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      onPointerEnter={(event) => {
        if (event.pointerType === "touch") return;
        onHighlight(reference);
        onHover(reference.card, event.currentTarget.getBoundingClientRect());
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "touch") onLeave(event.relatedTarget);
      }}
      onFocus={(event) => {
        onHighlight(reference);
        onHover(reference.card, event.currentTarget.getBoundingClientRect());
      }}
      onBlur={(event) => onLeave(event.relatedTarget)}
      onContextMenu={(event) => {
        onContextMenu(event);
        if (event.defaultPrevented || !onRightClick) return;
        event.preventDefault();
        onHighlight(reference);
        onRightClick(reference.card, event.currentTarget.getBoundingClientRect());
      }}
    >
      <GeneratedCardImage card={reference.card} className="aspect-[5/7] w-full rounded" />
      <span className="block max-w-24 truncate bg-background px-1 py-1 text-ui-meta text-foreground">
        {reference.card.attachedTo ? targetLabel : unattachedLabel}
        {phasedOut && <span className="block text-muted-foreground">Phased out</span>}
      </span>
    </button>
  );
}
