import { useId, useRef, useState, type ReactNode } from "react";
import { ArrowDownAZ, ChevronDown, ChevronRight } from "lucide-react";
import type { CardDto } from "@/protocol/game";
import { cn } from "@/lib/utils";
import { useLongPressPreview } from "@/hooks/useLongPressPreview";
import { AttachmentCounts } from "@/components/game/AttachmentCounts";
import { AttachmentMiniature } from "@/components/game/AttachmentMiniature";
import { AttachmentGroupPile } from "@/components/game/AttachmentGroupPile";
import {
  groupAttachments,
  type AttachmentReference,
  type AttachmentSection,
  type AttachmentSort,
} from "@/components/game/attachmentPanel";

export function RemoteAttachmentPile({
  sections,
  onHighlight,
  onHover,
  onRightClick,
  onLongPress,
  onLeave,
  onDismissPreview,
  previewActive = false,
}: {
  sections: AttachmentSection[];
  onHighlight: (card: AttachmentReference | null) => void;
  onHover: (card: CardDto, anchor: DOMRect) => void;
  onRightClick?: (card: CardDto, anchor: DOMRect) => void;
  onLongPress?: (card: CardDto, anchor: DOMRect) => void;
  onLeave: () => void;
  onDismissPreview: () => void;
  previewActive?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [sortBy, setSortBy] = useState<AttachmentSort>("attachee");
  const panelRef = useRef<HTMLElement>(null);
  const populatedSections = sections.filter((section) => section.cards.length > 0);
  const cards = populatedSections.flatMap((section) => section.cards);
  const previewAnchor = (anchor: DOMRect) => {
    const panel = panelRef.current;
    if (!panel) return anchor;
    const bounds = panel.getBoundingClientRect();
    const right = panel.parentElement?.getBoundingClientRect().right ?? bounds.right;
    return new DOMRect(right - bounds.width, bounds.top, bounds.width, bounds.height);
  };
  const leaveCard = (nextTarget: EventTarget | null = null) => {
    onHighlight(null);
    if (nextTarget instanceof Node && panelRef.current?.contains(nextTarget)) onDismissPreview();
    else onLeave();
  };
  const collapse = () => {
    setExpanded(false);
    leaveCard();
  };
  const longPress = useLongPressPreview<AttachmentReference>({
    resolve: (event) => {
      const anchor =
        event.target instanceof HTMLElement
          ? event.target.closest<HTMLButtonElement>("[data-attachment-proxy]")
          : null;
      const item = cards.find((reference) => reference.card.id === anchor?.dataset.attachmentProxy);
      return anchor && item ? { item, anchor } : null;
    },
    show: (reference, anchor) => {
      onHighlight(reference);
      onLongPress?.(reference.card, previewAnchor(anchor));
    },
    hide: onLeave,
    hideOnRelease: false,
  });
  if (cards.length === 0) return null;
  return (
    <section
      ref={panelRef}
      data-board-input-blocker=""
      aria-label="Your Attachments"
      className={cn(
        "pointer-events-none absolute right-0 bottom-24 z-40 flex max-w-[min(70vw,32rem)] items-end transition-transform duration-150 motion-reduce:transition-none",
        expanded ? "translate-x-0" : "translate-x-[calc(100%-5rem)]",
      )}
      onPointerDown={longPress.onPointerDown}
      onPointerMove={(event) => {
        longPress.onPointerMove(event);
        if (
          previewActive &&
          event.pointerType !== "touch" &&
          event.target instanceof Element &&
          !event.target.closest("[data-attachment-proxy]")
        )
          onDismissPreview();
      }}
      onPointerUp={longPress.onPointerUp}
      onPointerCancel={longPress.onPointerCancel}
      onClickCapture={longPress.onClickCapture}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") setExpanded(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "touch" && !event.currentTarget.contains(document.activeElement))
          collapse();
      }}
      onFocusCapture={(event) => {
        if (event.target.matches(":focus-visible")) setExpanded(true);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) collapse();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          if (previewActive) onDismissPreview();
          else collapse();
        }
      }}
    >
      <button
        type="button"
        aria-expanded={expanded}
        className="pointer-events-auto flex h-16 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-l-lg border border-border bg-background/80 px-2 py-2 text-center text-ui-meta font-medium leading-tight text-foreground shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        onClick={() => (expanded ? collapse() : setExpanded(true))}
      >
        <span>Your Attachments</span>
      </button>
      <div
        inert={!expanded}
        className="pointer-events-auto flex max-h-[calc(100vh-8rem)] w-[28rem] min-w-0 flex-col gap-3 overflow-auto rounded-tl-lg border border-border bg-background/80 p-3 shadow-lg"
      >
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-ui-label font-medium text-foreground">Your Attachments</h2>
          <AttachmentCounts cards={cards} />
          <button
            type="button"
            title={`Switch to ${sortBy === "attachee" ? "attachment" : "attachee"} name sorting`}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-ui-meta text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => {
              onHighlight(null);
              onDismissPreview();
              setSortBy((value) => (value === "attachee" ? "attachment" : "attachee"));
            }}
          >
            <ArrowDownAZ aria-hidden="true" className="size-3.5" />
            Sort: {sortBy === "attachee" ? "Attachee name" : "Attachment name"}
          </button>
        </header>
        {populatedSections.map((section) => (
          <AttachmentBoardSection
            key={section.playerId}
            section={section}
            onToggle={() => {
              onHighlight(null);
              onDismissPreview();
            }}
          >
            {[true, false].map((attached) => {
              const group = section.cards.filter(
                (reference) => Boolean(reference.card.attachedTo) === attached,
              );
              if (group.length === 0) return null;
              return (
                <div key={String(attached)} className="space-y-1">
                  <h4 className="text-ui-meta text-muted-foreground">
                    {attached ? "Attached" : "Unattached"}
                  </h4>
                  <div className="space-y-2">
                    {groupAttachments(group, sortBy).map((pile) => (
                      <AttachmentGroupPile
                        key={`${sortBy}:${pile.key}`}
                        group={pile}
                        onToggle={() => {
                          onHighlight(null);
                          onDismissPreview();
                        }}
                        renderCard={(reference) => (
                          <AttachmentMiniature
                            key={reference.card.id}
                            reference={reference}
                            onHighlight={onHighlight}
                            onHover={(card, anchor) => onHover(card, previewAnchor(anchor))}
                            onRightClick={
                              onRightClick
                                ? (card, anchor) => onRightClick(card, previewAnchor(anchor))
                                : undefined
                            }
                            onLeave={leaveCard}
                            onContextMenu={longPress.onContextMenu}
                          />
                        )}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </AttachmentBoardSection>
        ))}
      </div>
    </section>
  );
}

function AttachmentBoardSection({
  section,
  onToggle,
  children,
}: {
  section: AttachmentSection;
  onToggle: () => void;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <section aria-label={section.title} className="space-y-2 border-t border-border pt-2">
      <h3>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={contentId}
          className="flex w-full flex-wrap items-center gap-2 rounded py-1 text-left text-ui-meta font-medium text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() => {
            onToggle();
            setExpanded((value) => !value);
          }}
        >
          <Chevron aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{section.title}</span>
          <AttachmentCounts cards={section.cards} />
        </button>
      </h3>
      <div id={contentId} hidden={!expanded} className="space-y-2">
        {children}
      </div>
    </section>
  );
}
