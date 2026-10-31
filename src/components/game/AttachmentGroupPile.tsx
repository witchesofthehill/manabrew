import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { GeneratedCardImage } from "@/components/game/GeneratedCardImage";
import type { AttachmentGroup, AttachmentReference } from "@/components/game/attachmentPanel";

export function AttachmentGroupPile({
  group,
  onToggle,
  renderCard,
}: {
  group: AttachmentGroup;
  onToggle: () => void;
  renderCard: (reference: AttachmentReference) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div className="rounded border border-border bg-background/40">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        title={group.title}
        className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-ui-meta text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        onClick={() => {
          onToggle();
          setExpanded((value) => !value);
        }}
      >
        <Chevron aria-hidden="true" className="size-3.5 shrink-0" />
        {!expanded && (
          <span aria-hidden="true" className="relative h-16 w-12 shrink-0">
            {group.cards.slice(0, 3).map((reference, index) => (
              <span
                key={reference.card.id}
                className="absolute left-0 top-0 w-10"
                style={{ transform: `translate(${index * 3}px, ${index * 2}px)` }}
              >
                <GeneratedCardImage card={reference.card} className="aspect-[5/7] w-full rounded" />
              </span>
            ))}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate font-medium">{group.title}</span>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {group.cards.length} {group.cards.length === 1 ? "attachment" : "attachments"}
        </span>
      </button>
      <div id={contentId} hidden={!expanded}>
        {expanded && (
          <div className="flex items-start gap-2 overflow-x-auto px-2 pb-2">
            {group.cards.map(renderCard)}
          </div>
        )}
      </div>
    </div>
  );
}
