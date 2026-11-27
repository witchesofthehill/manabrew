import { AlertTriangle } from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { cn } from "@/lib/utils";
import { useIsUnsupported } from "@/stores/useCardSupportStore";
import type { DeckCard } from "@/protocol/deck";
import { CardMenuButton } from "./DeckListView";
import { CardThumbnail } from "./deckEditor.primitives";
import { CollectionOwnershipTooltip } from "./CollectionOwnershipTooltip";
import { CommandZoneCardMenu, type CommandZoneCardMenuActions } from "./CommandZoneCardMenu";
import { useCardCollectionOwnership, useDeckCardOwnership } from "./useCardCollectionOwnership";
import type { ViewMode } from "./deckBuilder.utils";

export function CommandZoneCard({
  card,
  label,
  viewMode,
  cardWidth,
  stackOffset,
  readOnly,
  onShowInfo,
  onStackHover,
  menuActions,
}: {
  card: DeckCard;
  label: string;
  viewMode: ViewMode;
  cardWidth: number;
  stackOffset: number;
  readOnly: boolean;
  onShowInfo: () => void;
  onStackHover?: () => void;
  menuActions?: CommandZoneCardMenuActions;
}) {
  const name = card.identity.name;
  const list = viewMode === "list";
  const stack = viewMode === "stack";
  const unsupported = useIsUnsupported(name);
  const ownership = useCardCollectionOwnership(card);
  const partial = useDeckCardOwnership(card)?.status === "partial";
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `deck-commander-${name}`,
    data: { type: "deck-card", card, name },
    disabled: readOnly,
  });
  const content = (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        "group relative select-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        list
          ? "flex touch:min-h-11 items-center gap-1 rounded px-1 py-0.5 hover:bg-muted/40"
          : "shrink-0 rounded-lg",
        stack &&
          "col-start-1 row-start-1 self-start motion-safe:transition-[margin-top] motion-safe:duration-200",
        !readOnly && "cursor-grab active:cursor-grabbing",
        !list && !readOnly && "touch-none",
        isDragging && "opacity-30",
        list
          ? cn(
              unsupported && "bg-warning/10 ring-1 ring-warning/40",
              ownership === "exact" && "border-l-2 border-legality-legal bg-legality-legal/10",
              ownership === "other" && "border-l-2 border-dashed border-primary/70 bg-primary/5",
              partial && "border-l-2 border-warning bg-warning/10",
            )
          : cn(
              unsupported && "ring-2 ring-warning/70",
              ownership === "exact" && "outline outline-2 outline-legality-legal/60",
              ownership === "other" && "outline-dashed outline outline-1 outline-primary/60",
              partial && "outline outline-2 outline-warning/70",
            ),
      )}
      style={list ? undefined : { width: cardWidth, marginTop: stackOffset }}
      tabIndex={0}
      role="button"
      aria-label={`${name}, ${label}`}
      data-card-id={card.identity.id}
      data-card-ownership={ownership}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") onStackHover?.();
      }}
      onFocus={(event) => {
        if (event.target.matches(":focus-visible")) onStackHover?.();
      }}
      onClick={onShowInfo}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || !["Enter", " "].includes(event.key)) return;
        event.preventDefault();
        onShowInfo();
      }}
    >
      {list ? (
        <>
          <CollectionOwnershipTooltip card={card} surface="text" />
          {unsupported && (
            <AlertTriangle
              className="size-3 shrink-0 text-warning"
              aria-label="Unsupported by the Manabrew and Forge engines"
            />
          )}
          <span
            className={cn("min-w-0 flex-1 truncate text-ui-label", unsupported && "text-warning")}
            title={name}
          >
            {name}
          </span>
          <span className="shrink-0 text-ui-meta text-muted-foreground">{label}</span>
          {card.manaCost && <ManaSymbols cost={card.manaCost} size="sm" className="shrink-0" />}
        </>
      ) : (
        <>
          <CardThumbnail card={card} />
          <CollectionOwnershipTooltip card={card} surface="visual" className="left-1 top-7" />
          {unsupported && (
            <div
              className="absolute bottom-1 left-1 rounded-full bg-warning/90 p-0.5 text-background shadow"
              title="Unsupported by the Manabrew and Forge engines"
            >
              <AlertTriangle className="size-3" />
            </div>
          )}
          <span className="absolute left-1 top-1 rounded bg-overlay/75 px-1.5 py-0.5 text-ui-meta font-semibold text-foreground shadow">
            {label}
          </span>
        </>
      )}
      {menuActions && (
        <CardMenuButton
          alwaysVisible
          className={cn(
            !list && "absolute right-0 bg-background/95",
            stack ? "top-0" : !list && "bottom-0",
          )}
        />
      )}
    </div>
  );
  return menuActions ? (
    <CommandZoneCardMenu card={card} actions={menuActions}>
      {content}
    </CommandZoneCardMenu>
  ) : (
    content
  );
}
