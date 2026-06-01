import { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import {
  X,
  Minus,
  Plus,
  Download,
  Upload,
  Tag,
  GripVertical,
  ArrowUpToLine,
  ArrowDownToLine,
  HelpCircle,
  Info,
  Image as ImageIcon,
  Sparkles,
  Trash2,
  Bookmark,
  Check,
  AlertTriangle,
} from "lucide-react";
import { GameIcon } from "@/components/game/GameIcon";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type { DeckCard } from "@/types/manabrew";
import type { CardGroup, ViewMode, SectionDefinition } from "./deckBuilder.utils";
import { CARD_WIDTH_MAP, getTaggedGroups } from "./deckBuilder.utils";
import { CARD_RING } from "@/components/game/game.styles";
import { DROP_ZONE } from "@/lib/constants";
import { useMarquee } from "@/hooks/useMarqueeSelection";
import {
  CardCountBadge,
  CardThumbnail,
  CardHoverOverlay,
  CollapsibleHeader,
  EmptyDropZone,
} from "./deckEditor.primitives";
import { buildCardActions, handleCardClick } from "./deckEditor.utils";
import { useIsUnsupported } from "@/stores/useCardSupportStore";

type CardLocation = "main" | "side" | "maybe";

interface CardContextActions {
  onAddOne?: () => void;
  onRemoveOne?: () => void;
  onRemoveAll?: () => void;
  onMoveOneToMain?: () => void;
  onMoveAllToMain?: () => void;
  onMoveOneToSide?: () => void;
  onMoveAllToSide?: () => void;
  onMoveOneToMaybe?: () => void;
  onMoveAllToMaybe?: () => void;
  onShowInfo?: () => void;
  onPickPrint?: () => void;
  onToggleFoil?: () => void;
  isFoil?: boolean;
  customTags?: string[];
  appliedTags?: string[];
  onApplyTag?: (tag: string) => void;
  onRemoveCustomTag?: (tag: string) => void;
  onCreateTag?: (tag: string) => void;
}

interface CardContextMenuProps extends CardContextActions {
  children: React.ReactNode;
  count: number;
  location: CardLocation;
}

function MoveDestination({
  label,
  icon: Icon,
  count,
  onMoveOne,
  onMoveAll,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  onMoveOne?: () => void;
  onMoveAll?: () => void;
}) {
  if (!onMoveOne && !onMoveAll) return null;
  if (count <= 1 || !onMoveAll) {
    const handler = onMoveOne ?? onMoveAll!;
    return (
      <ContextMenuItem onSelect={handler}>
        <Icon className="mr-2 h-3.5 w-3.5" /> {label}
      </ContextMenuItem>
    );
  }
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <Icon className="mr-2 h-3.5 w-3.5" /> {label}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-36">
        {onMoveOne && <ContextMenuItem onSelect={onMoveOne}>Move 1</ContextMenuItem>}
        <ContextMenuItem onSelect={onMoveAll}>Move all ({count})</ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

function TagsSubmenu({
  customTags,
  appliedTags,
  onApplyTag,
  onRemoveCustomTag,
  onCreateTag,
}: {
  customTags?: string[];
  appliedTags?: string[];
  onApplyTag: (tag: string) => void;
  onRemoveCustomTag?: (tag: string) => void;
  onCreateTag?: (tag: string) => void;
}) {
  const [newTagInput, setNewTagInput] = useState("");
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <Bookmark className="mr-2 h-3.5 w-3.5" /> Tags
        {appliedTags && appliedTags.length > 0 && (
          <span className="ml-auto text-[10px] text-muted-foreground">{appliedTags.length}</span>
        )}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-56">
        {customTags && customTags.length > 0 ? (
          customTags.map((tag) => {
            const applied = appliedTags?.includes(tag) ?? false;
            return (
              <ContextMenuItem
                key={tag}
                onSelect={() => onApplyTag(tag)}
                className="justify-between"
              >
                <span className="flex items-center gap-2 truncate">
                  <Bookmark className="h-3.5 w-3.5 shrink-0 text-primary/60" />
                  <span className="truncate">{tag}</span>
                  {applied && <Check className="h-3 w-3 shrink-0 text-primary/70" />}
                </span>
                {onRemoveCustomTag && (
                  <button
                    type="button"
                    className="ml-2 rounded p-0.5 text-destructive hover:bg-muted shrink-0"
                    title={`Remove "${tag}" from deck`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveCustomTag(tag);
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </ContextMenuItem>
            );
          })
        ) : (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">No tags yet</div>
        )}
        {onCreateTag && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              asChild
              onSelect={(e: Event) => e.preventDefault()}
              onPointerMove={(e: ReactPointerEvent) => e.preventDefault()}
              onPointerLeave={(e: ReactPointerEvent) => e.preventDefault()}
              className="focus:bg-transparent p-1 cursor-text"
            >
              <div>
                <Input
                  className="h-7 text-xs"
                  placeholder="New tag…"
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter" && newTagInput.trim()) {
                      onCreateTag(newTagInput.trim());
                      setNewTagInput("");
                    }
                  }}
                  onKeyDownCapture={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                />
              </div>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

function CardContextMenu({
  children,
  count,
  location,
  onAddOne,
  onRemoveOne,
  onRemoveAll,
  onMoveOneToMain,
  onMoveAllToMain,
  onMoveOneToSide,
  onMoveAllToSide,
  onMoveOneToMaybe,
  onMoveAllToMaybe,
  onShowInfo,
  onPickPrint,
  onToggleFoil,
  isFoil,
  customTags,
  appliedTags,
  onApplyTag,
  onRemoveCustomTag,
  onCreateTag,
}: CardContextMenuProps) {
  const showTagSubmenu = !!onApplyTag && ((customTags && customTags.length > 0) || !!onCreateTag);
  const showAll = count > 1;
  const hasMoveActions =
    (location !== "main" && (onMoveOneToMain || onMoveAllToMain)) ||
    (location !== "side" && (onMoveOneToSide || onMoveAllToSide)) ||
    (location !== "maybe" && (onMoveOneToMaybe || onMoveAllToMaybe));
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        {onShowInfo && (
          <>
            <ContextMenuItem onSelect={onShowInfo}>
              <Info className="mr-2 h-3.5 w-3.5" /> Card info
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        {onAddOne && (
          <ContextMenuItem onSelect={onAddOne}>
            <Plus className="mr-2 h-3.5 w-3.5" /> Add 1
          </ContextMenuItem>
        )}
        {onRemoveOne && (
          <ContextMenuItem onSelect={onRemoveOne}>
            <Minus className="mr-2 h-3.5 w-3.5" /> Remove 1
          </ContextMenuItem>
        )}
        {onRemoveAll && showAll && (
          <ContextMenuItem onSelect={onRemoveAll} className="text-destructive">
            <Trash2 className="mr-2 h-3.5 w-3.5" /> Remove all ({count})
          </ContextMenuItem>
        )}
        {hasMoveActions && <ContextMenuSeparator />}
        {location !== "main" && (
          <MoveDestination
            label="Move to main"
            icon={ArrowUpToLine}
            count={count}
            onMoveOne={onMoveOneToMain}
            onMoveAll={onMoveAllToMain}
          />
        )}
        {location !== "side" && (
          <MoveDestination
            label="Move to sideboard"
            icon={ArrowDownToLine}
            count={count}
            onMoveOne={onMoveOneToSide}
            onMoveAll={onMoveAllToSide}
          />
        )}
        {location !== "maybe" && (
          <MoveDestination
            label="Move to maybeboard"
            icon={HelpCircle}
            count={count}
            onMoveOne={onMoveOneToMaybe}
            onMoveAll={onMoveAllToMaybe}
          />
        )}
        {showTagSubmenu && (
          <>
            <ContextMenuSeparator />
            <TagsSubmenu
              customTags={customTags}
              appliedTags={appliedTags}
              onApplyTag={onApplyTag!}
              onRemoveCustomTag={onRemoveCustomTag}
              onCreateTag={onCreateTag}
            />
          </>
        )}
        {onPickPrint && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={onPickPrint}>
              <ImageIcon className="mr-2 h-3.5 w-3.5" /> Choose printing…
            </ContextMenuItem>
          </>
        )}
        {onToggleFoil && (
          <ContextMenuItem onSelect={onToggleFoil}>
            <Sparkles
              className={cn(
                "mr-2 h-3.5 w-3.5",
                isFoil ? "text-yellow-300" : "text-muted-foreground",
              )}
            />
            {isFoil ? "Remove foil" : "Make foil"}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ─── Draggable Stack Card ─────────────────────────────────────────────────────

function DraggableStackCard({
  group,
  dragId,
  cardWidth,
  index,
  onAddOne,
  onRemoveOne,
  onUntag,
  isSelected,
  onSelect,
  onShowInfo,
  topOffset,
  onCardHover,
  onCardLeave,
}: {
  group: CardGroup;
  dragId: string;
  cardWidth: number;
  index: number;
  onAddOne: () => void;
  onRemoveOne: () => void;
  onUntag?: (cardName: string) => void;
  isSelected?: boolean;
  onSelect?: (cardName: string, addToSelection: boolean) => void;
  onShowInfo?: () => void;
  topOffset: number;
  onCardHover: (index: number) => void;
  onCardLeave: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: { type: "deck-card", card: group.card, name: group.card.name },
  });
  const unsupported = useIsUnsupported(group.card.name);

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        "absolute left-0 group cursor-grab active:cursor-grabbing transition-[top] duration-200 ease-out",
        isDragging && "opacity-30",
        isSelected && cn(CARD_RING.selected, "z-50"),
        unsupported && "ring-2 ring-warning/70 rounded-[4%]",
      )}
      style={{ top: topOffset, width: cardWidth, zIndex: index + 1 }}
      data-card-name={group.card.name}
      data-card-supported={unsupported ? "false" : undefined}
      onMouseEnter={() => onCardHover(index)}
      onMouseLeave={onCardLeave}
      onClick={(e) => handleCardClick(e, group.card.name, onSelect, onShowInfo)}
    >
      <CardThumbnail card={group.card} />
      <CardCountBadge count={group.count} className="border-white/30 shadow" />
      {unsupported && (
        <div
          className="absolute top-1 right-1 z-30 rounded-full bg-warning/90 text-white p-0.5 shadow"
          title="Not implemented by the engine — deck can only be saved as draft"
        >
          <AlertTriangle className="h-3 w-3" />
        </div>
      )}
      <CardHoverOverlay
        actions={buildCardActions(
          onAddOne,
          onRemoveOne,
          onUntag ? () => onUntag(group.card.name) : undefined,
        )}
        rounded="rounded-[4%]"
      />
    </div>
  );
}

// ─── Section Drag Handle ─────────────────────────────────────────────────────

interface DragHandleProps {
  onMouseDown: (e: React.MouseEvent) => void;
}

// ─── Stack Column Component ───────────────────────────────────────────────────

interface StackColumnProps {
  label: string;
  sectionId: string;
  groups: CardGroup[];
  cardWidth: number;
  onAddOne: (g: CardGroup) => void;
  onRemoveOne: (name: string) => void;
  onUntag?: (cardName: string) => void;
  selectedCards?: Set<string>;
  onSelectCard?: (cardName: string, addToSelection: boolean) => void;
  onShowInfo?: (cardName: string) => void;
  dragHandleProps?: DragHandleProps;
}

function StackColumn({
  label,
  sectionId,
  groups,
  cardWidth,
  onAddOne,
  onRemoveOne,
  onUntag,
  selectedCards,
  onSelectCard,
  onShowInfo,
  dragHandleProps,
}: StackColumnProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const cardHeight = Math.round(cardWidth * 1.4);
  const peek = Math.round(cardHeight * 0.22);
  const count = groups.reduce((s, g) => s + g.count, 0);

  // When a card is hovered, cards below it slide down to reveal the full card
  const spreadAmount = cardHeight - peek;
  const getTop = (i: number) => {
    const base = i * peek;
    if (hoveredIdx === null || i <= hoveredIdx) return base;
    return base + spreadAmount;
  };

  const totalHeight =
    groups.length > 0
      ? hoveredIdx !== null
        ? getTop(groups.length - 1) + cardHeight
        : peek * (groups.length - 1) + cardHeight
      : 0;

  return (
    <div className="shrink-0 flex flex-col" style={{ width: cardWidth }}>
      <div className="flex items-center gap-1 mb-2 truncate">
        {dragHandleProps && (
          <div
            className="shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            onMouseDown={dragHandleProps.onMouseDown}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </div>
        )}
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide truncate">
          {label} <span className="font-normal opacity-60">({count})</span>
        </span>
      </div>
      <div
        className="relative transition-[height] duration-200 ease-out"
        style={{ height: totalHeight }}
      >
        {groups.map((g, i) => (
          <DraggableStackCard
            key={g.card.name}
            group={g}
            dragId={`deck-${sectionId}-${g.card.name}`}
            cardWidth={cardWidth}
            index={i}
            onAddOne={() => onAddOne(g)}
            onRemoveOne={() => onRemoveOne(g.card.name)}
            onUntag={onUntag ? () => onUntag(g.card.name) : undefined}
            isSelected={selectedCards?.has(g.card.name.toLowerCase())}
            onSelect={onSelectCard}
            onShowInfo={onShowInfo ? () => onShowInfo(g.card.name) : undefined}
            topOffset={getTop(i)}
            onCardHover={setHoveredIdx}
            onCardLeave={() => setHoveredIdx(null)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Visual Grid Card ─────────────────────────────────────────────────────────

interface CardVisualProps {
  group: CardGroup;
  dragId: string;
  onAddOne: () => void;
  onRemoveOne: () => void;
  onPickPrint: () => void;
  isSelected?: boolean;
  onSelect?: (cardName: string, addToSelection: boolean) => void;
  onShowInfo?: () => void;
  onUntag?: () => void;
  isCommander?: boolean;
  showCommander?: boolean;
  onSetCommander?: () => void;
  onRemoveCommander?: () => void;
  isCover?: boolean;
  isCoverBack?: boolean;
  onSetCover?: () => void;
  onSetCoverBack?: () => void;
  contextLocation?: CardLocation;
  contextActions?: CardContextActions;
}

function CardVisual({
  group,
  dragId,
  onAddOne,
  onRemoveOne,
  isSelected,
  onSelect,
  onShowInfo,
  onUntag,
  isCommander,
  showCommander,
  onSetCommander,
  onRemoveCommander,
  isCover,
  isCoverBack,
  onSetCover,
  onSetCoverBack,
  contextLocation,
  contextActions,
}: CardVisualProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: { type: "deck-card", card: group.card, name: group.card.name },
  });
  const unsupported = useIsUnsupported(group.card.name);

  const visualContent = (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        "relative group cursor-grab active:cursor-grabbing select-none transition-[box-shadow]",
        isDragging && "opacity-30",
        isSelected && cn(CARD_RING.selected, "rounded-lg"),
        unsupported && "ring-2 ring-warning/70 rounded-lg",
      )}
      data-card-name={group.card.name}
      data-card-supported={unsupported ? "false" : undefined}
      onClick={(e) => handleCardClick(e, group.card.name, onSelect, onShowInfo)}
    >
      <CardThumbnail card={group.card} />
      <CardCountBadge count={group.count} />
      {unsupported && (
        <div
          className="absolute top-1 right-1 z-30 rounded-full bg-warning/90 text-white p-0.5 shadow"
          title="Not implemented by the engine — deck can only be saved as draft"
        >
          <AlertTriangle className="h-3 w-3" />
        </div>
      )}
      <div className="absolute top-1 left-1 z-20 flex gap-0.5">
        {showCommander && (
          <button
            type="button"
            className={cn(
              "rounded-full p-0.5 shadow transition-colors",
              isCommander
                ? "bg-commander/90 text-white"
                : "bg-overlay/70 text-muted-foreground opacity-0 group-hover:opacity-100",
            )}
            title={isCommander ? "Remove commander" : "Set as commander"}
            onClick={(e) => {
              e.stopPropagation();
              if (isCommander) onRemoveCommander?.();
              else onSetCommander?.();
            }}
          >
            <GameIcon name="overlord-helm" className="h-3.5 w-3.5" />
          </button>
        )}
        {onSetCover && (
          <button
            type="button"
            className={cn(
              "rounded-full p-0.5 shadow transition-colors",
              isCover
                ? "bg-primary/90 text-white"
                : "bg-overlay/70 text-muted-foreground opacity-0 group-hover:opacity-100",
            )}
            title={isCover ? "Remove as deck art cover" : "Set as deck art cover"}
            onClick={(e) => {
              e.stopPropagation();
              onSetCover();
            }}
          >
            <GameIcon name="book-cover" className="h-3.5 w-3.5" />
          </button>
        )}
        {onSetCoverBack && (
          <button
            type="button"
            className={cn(
              "rounded-full p-0.5 shadow transition-colors",
              isCoverBack
                ? "bg-primary/90 text-white"
                : "bg-overlay/70 text-muted-foreground opacity-0 group-hover:opacity-100",
            )}
            title={
              isCoverBack ? "Remove back face as deck art cover" : "Set back face as deck art cover"
            }
            onClick={(e) => {
              e.stopPropagation();
              onSetCoverBack();
            }}
          >
            <GameIcon
              name="book-cover"
              className="h-3.5 w-3.5"
              style={{ transform: "scaleX(-1)" }}
            />
          </button>
        )}
      </div>
      <CardHoverOverlay actions={buildCardActions(onAddOne, onRemoveOne, onUntag)} />
    </div>
  );

  if (!contextActions || !contextLocation) return visualContent;
  return (
    <CardContextMenu count={group.count} location={contextLocation} {...contextActions}>
      {visualContent}
    </CardContextMenu>
  );
}

function DraggableMiniRow({
  dragId,
  card,
  className,
  children,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
}: {
  dragId: string;
  card: DeckCard;
  className?: string;
  children: React.ReactNode;
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseMove?: (e: React.MouseEvent) => void;
  onMouseLeave?: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: { type: "deck-card", card, name: card.name },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        className,
        "cursor-grab active:cursor-grabbing select-none",
        isDragging && "opacity-30",
      )}
      data-card-name={card.name}
      onMouseEnter={onMouseEnter}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </div>
  );
}

// ─── List Row ─────────────────────────────────────────────────────────────────

interface CardRowProps {
  group: CardGroup;
  dragId: string;
  isCommander: boolean;
  showCommander: boolean;
  onAddOne: () => void;
  onRemoveOne: () => void;
  onRemoveAll: () => void;
  onSetCommander: () => void;
  onRemoveCommander: () => void;
  onMoveOneToSide: () => void;
  onPickPrint: () => void;
  isSelected?: boolean;
  onSelect?: (cardName: string, addToSelection: boolean) => void;
  onShowInfo?: () => void;
  isCover?: boolean;
  isCoverBack?: boolean;
  onSetCover?: () => void;
  onSetCoverBack?: () => void;
  contextActions?: CardContextActions;
}

function CardRow({
  group,
  dragId,
  isCommander,
  showCommander,
  onAddOne,
  onRemoveOne,
  onRemoveAll,
  onSetCommander,
  onRemoveCommander,
  onMoveOneToSide,
  isSelected,
  onSelect,
  onShowInfo,
  isCover,
  isCoverBack,
  onSetCover,
  onSetCoverBack,
  contextActions,
}: CardRowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: { type: "deck-card", card: group.card, name: group.card.name },
  });
  const unsupported = useIsUnsupported(group.card.name);

  const rowContent = (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        "flex items-center gap-1 group hover:bg-muted/40 rounded px-1 py-0.5 cursor-grab active:cursor-grabbing select-none transition-colors",
        isDragging && "opacity-30",
        isSelected && "bg-selection/20",
        unsupported && "bg-warning/10 ring-1 ring-warning/40",
      )}
      data-card-name={group.card.name}
      data-card-supported={unsupported ? "false" : undefined}
      onClick={(e) => {
        e.stopPropagation();
        if (e.shiftKey && onSelect) {
          onSelect(group.card.name, true);
        } else if (onShowInfo) {
          onShowInfo();
        }
      }}
    >
      <div
        className={cn(
          "w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors cursor-pointer hover:border-selection",
          isSelected ? "bg-selection border-selection" : "border-muted-foreground/40",
        )}
        onClick={(e) => {
          e.stopPropagation();
          onSelect?.(group.card.name, e.shiftKey);
        }}
      >
        {isSelected && <span className="text-[8px] text-white font-bold">✓</span>}
      </div>
      <span className="text-xs font-mono w-4 text-right text-muted-foreground shrink-0">
        {group.count}
      </span>
      {unsupported && (
        <AlertTriangle
          className="h-3 w-3 text-warning shrink-0"
          aria-label="Card not supported by the engine"
        />
      )}
      <span
        className={cn("text-sm flex-1 truncate", unsupported && "text-warning")}
        title={
          unsupported
            ? `${group.card.name} — not implemented by the engine; deck can only be saved as draft`
            : group.card.name
        }
      >
        {group.card.name}
      </span>
      {group.card.manaCost && (
        <ManaSymbols cost={group.card.manaCost} size="sm" className="shrink-0" />
      )}
      {group.card.power && group.card.toughness && (
        <span className="text-xs text-muted-foreground/60 shrink-0 font-mono">
          {group.card.power}/{group.card.toughness}
        </span>
      )}
      <div className="flex gap-0.5 shrink-0">
        {showCommander && (
          <Button
            size="icon"
            variant="ghost"
            className={
              isCommander
                ? "h-5 w-5 text-commander"
                : "h-5 w-5 text-muted-foreground/40 hover:text-commander transition-colors"
            }
            title={isCommander ? "Remove commander" : "Set as commander"}
            onClick={(e) => {
              e.stopPropagation();
              if (isCommander) onRemoveCommander();
              else onSetCommander();
            }}
          >
            <GameIcon name="overlord-helm" className="h-3 w-3" />
          </Button>
        )}
        {onSetCover && (
          <Button
            size="icon"
            variant="ghost"
            className={
              isCover
                ? "h-5 w-5 text-primary"
                : "h-5 w-5 text-muted-foreground/40 hover:text-primary transition-colors"
            }
            title={isCover ? "Remove as deck art cover" : "Set as deck art cover"}
            onClick={(e) => {
              e.stopPropagation();
              onSetCover();
            }}
          >
            <GameIcon name="book-cover" className="h-3 w-3" />
          </Button>
        )}
        {onSetCoverBack && (
          <Button
            size="icon"
            variant="ghost"
            className={
              isCoverBack
                ? "h-5 w-5 text-primary"
                : "h-5 w-5 text-muted-foreground/40 hover:text-primary transition-colors"
            }
            title={
              isCoverBack ? "Remove back face as deck art cover" : "Set back face as deck art cover"
            }
            onClick={(e) => {
              e.stopPropagation();
              onSetCoverBack();
            }}
          >
            <GameIcon name="book-cover" className="h-3 w-3" style={{ transform: "scaleX(-1)" }} />
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="h-5 w-5"
          title="Add one"
          onClick={(e) => {
            e.stopPropagation();
            onAddOne();
          }}
        >
          <Plus className="h-3 w-3" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-5 w-5"
          title="Remove one"
          onClick={(e) => {
            e.stopPropagation();
            onRemoveOne();
          }}
        >
          <Minus className="h-3 w-3" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-5 w-5 text-muted-foreground"
          title="Move 1 to sideboard"
          onClick={(e) => {
            e.stopPropagation();
            onMoveOneToSide();
          }}
        >
          <Download className="h-3 w-3" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-5 w-5 text-destructive"
          title="Remove all"
          onClick={(e) => {
            e.stopPropagation();
            onRemoveAll();
          }}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );

  if (!contextActions) return rowContent;
  return (
    <CardContextMenu count={group.count} location="main" {...contextActions}>
      {rowContent}
    </CardContextMenu>
  );
}

// ─── Unified Collapsible Card Section ─────────────────────────────────────────

interface CardSectionProps {
  label: string;
  sectionId: string;
  groups: CardGroup[];
  commanderNames?: Set<string>;
  deckFormat?: string;
  viewMode: ViewMode;
  cardWidth: number;
  onAddOne: (g: CardGroup) => void;
  onRemoveOne: (name: string) => void;
  onRemoveAll: (name: string) => void;
  onSetCommander: (card: DeckCard) => void;
  onRemoveCommander: (card?: DeckCard) => void;
  onMoveOneToSide: (name: string) => void;
  onMoveAllToSide: (name: string) => void;
  onMoveOneToMaybe: (name: string) => void;
  onMoveAllToMaybe: (name: string) => void;
  onPickPrint: (name: string) => void;
  onToggleFoil?: (name: string) => void;
  selectedCards?: Set<string>;
  onSelectCard?: (cardName: string, addToSelection: boolean) => void;
  onShowInfo?: (cardName: string) => void;
  // Tag-specific props (optional)
  tag?: string;
  onUntagCard?: (cardName: string) => void;
  onRemoveTag?: () => void;
  coverCardName?: string;
  coverCardFace?: 0 | 1;
  onSetCover?: (card: DeckCard) => void;
  onSetCoverBack?: (card: DeckCard) => void;
  customTags?: string[];
  cardTagsByName?: Record<string, string[]>;
  onApplyCardTag?: (cardName: string, tag: string) => void;
  onCreateAndApplyTag?: (cardName: string, tag: string) => void;
  onRemoveCustomTag?: (tag: string) => void;
}

function CardSection({
  label,
  sectionId,
  groups,
  commanderNames,
  deckFormat,
  viewMode,
  cardWidth,
  onAddOne,
  onRemoveOne,
  onRemoveAll,
  onSetCommander,
  onRemoveCommander,
  onMoveOneToSide,
  onMoveAllToSide,
  onMoveOneToMaybe,
  onMoveAllToMaybe,
  onPickPrint,
  onToggleFoil,
  selectedCards,
  onSelectCard,
  onShowInfo,
  tag,
  onUntagCard,
  onRemoveTag,
  coverCardName,
  coverCardFace,
  onSetCover,
  onSetCoverBack,
  customTags,
  cardTagsByName,
  onApplyCardTag,
  onCreateAndApplyTag,
  onRemoveCustomTag,
}: CardSectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  const isTagSection = !!tag;
  const { setNodeRef, isOver } = useDroppable({
    id: isTagSection ? `${DROP_ZONE.TAG_PREFIX}${tag}` : `section-${sectionId}`,
    disabled: !isTagSection,
  });

  if (!isTagSection && groups.length === 0) return null;
  const count = groups.reduce((s, g) => s + g.count, 0);
  const dragPrefix = isTagSection ? `deck-tag-${tag}` : `deck-${sectionId}`;
  const effectiveRemoveOne = isTagSection && onUntagCard ? onUntagCard : onRemoveOne;

  const headerExtra =
    isTagSection && onRemoveTag ? (
      <Button
        size="icon"
        variant="ghost"
        className="h-5 w-5 text-destructive opacity-0 hover:opacity-100 transition-opacity shrink-0"
        title={`Remove "${tag}" tag`}
        onClick={onRemoveTag}
      >
        <X className="h-3 w-3" />
      </Button>
    ) : undefined;

  return (
    <div
      ref={isTagSection ? setNodeRef : undefined}
      className={cn(
        "mb-3",
        isTagSection && "rounded-lg transition-colors p-1 -mx-1",
        isOver && "bg-primary/10",
      )}
    >
      <CollapsibleHeader
        label={label}
        count={count}
        collapsed={collapsed}
        onToggle={() => setCollapsed((v) => !v)}
        extraContent={headerExtra}
      />

      {!collapsed &&
        (groups.length === 0 ? (
          <EmptyDropZone message="Drag cards here" />
        ) : viewMode === "list" ? (
          <div className="space-y-0.5">
            {groups.map((g) => (
              <div
                key={g.card.name}
                className={cn("flex items-center gap-1", isTagSection && "group/tag")}
              >
                <div className="flex-1 min-w-0">
                  <CardRow
                    group={g}
                    dragId={`${dragPrefix}-${g.card.name}`}
                    isCommander={commanderNames?.has(g.card.name) ?? false}
                    showCommander={deckFormat === "commander"}
                    onAddOne={() => onAddOne(g)}
                    onRemoveOne={() => effectiveRemoveOne(g.card.name)}
                    onRemoveAll={() => onRemoveAll(g.card.name)}
                    onSetCommander={() => onSetCommander(g.card)}
                    onRemoveCommander={onRemoveCommander}
                    onMoveOneToSide={() => onMoveOneToSide(g.card.name)}
                    onPickPrint={() => onPickPrint(g.card.name)}
                    isSelected={selectedCards?.has(g.card.name.toLowerCase())}
                    onSelect={onSelectCard}
                    onShowInfo={onShowInfo ? () => onShowInfo(g.card.name) : undefined}
                    isCover={coverCardName === g.card.name && (coverCardFace ?? 0) === 0}
                    isCoverBack={coverCardName === g.card.name && coverCardFace === 1}
                    onSetCover={onSetCover ? () => onSetCover(g.card) : undefined}
                    onSetCoverBack={
                      g.card.isDoubleFaced && onSetCoverBack
                        ? () => onSetCoverBack(g.card)
                        : undefined
                    }
                    contextActions={{
                      onAddOne: () => onAddOne(g),
                      onRemoveOne: () => effectiveRemoveOne(g.card.name),
                      onRemoveAll: () => onRemoveAll(g.card.name),
                      onMoveOneToSide: () => onMoveOneToSide(g.card.name),
                      onMoveAllToSide: () => onMoveAllToSide(g.card.name),
                      onMoveOneToMaybe: () => onMoveOneToMaybe(g.card.name),
                      onMoveAllToMaybe: () => onMoveAllToMaybe(g.card.name),
                      onShowInfo: onShowInfo ? () => onShowInfo(g.card.name) : undefined,
                      onPickPrint: () => onPickPrint(g.card.name),
                      onToggleFoil: onToggleFoil ? () => onToggleFoil(g.card.name) : undefined,
                      isFoil: !!g.card.foil,
                      customTags,
                      appliedTags: cardTagsByName?.[g.card.name.toLowerCase()],
                      onApplyTag: onApplyCardTag
                        ? (t) => onApplyCardTag(g.card.name, t)
                        : undefined,
                      onRemoveCustomTag,
                      onCreateTag: onCreateAndApplyTag
                        ? (t) => onCreateAndApplyTag(g.card.name, t)
                        : undefined,
                    }}
                  />
                </div>
                {isTagSection && onUntagCard && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-5 w-5 text-muted-foreground/40 opacity-0 group-hover/tag:opacity-100 transition-opacity shrink-0"
                    title="Remove from this tag"
                    onClick={() => onUntagCard(g.card.name)}
                  >
                    <Tag className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <div key={g.card.name} className="shrink-0" style={{ width: cardWidth }}>
                <CardVisual
                  group={g}
                  dragId={`${dragPrefix}-${g.card.name}`}
                  onAddOne={() => onAddOne(g)}
                  onRemoveOne={() => effectiveRemoveOne(g.card.name)}
                  onUntag={isTagSection && onUntagCard ? () => onUntagCard(g.card.name) : undefined}
                  onPickPrint={() => onPickPrint(g.card.name)}
                  isSelected={selectedCards?.has(g.card.name.toLowerCase())}
                  onSelect={onSelectCard}
                  onShowInfo={onShowInfo ? () => onShowInfo(g.card.name) : undefined}
                  isCommander={commanderNames?.has(g.card.name) ?? false}
                  showCommander={deckFormat === "commander"}
                  onSetCommander={() => onSetCommander(g.card)}
                  onRemoveCommander={onRemoveCommander}
                  isCover={coverCardName === g.card.name && (coverCardFace ?? 0) === 0}
                  isCoverBack={coverCardName === g.card.name && coverCardFace === 1}
                  onSetCover={onSetCover ? () => onSetCover(g.card) : undefined}
                  onSetCoverBack={
                    g.card.isDoubleFaced && onSetCoverBack
                      ? () => onSetCoverBack(g.card)
                      : undefined
                  }
                  contextLocation="main"
                  contextActions={{
                    onAddOne: () => onAddOne(g),
                    onRemoveOne: () => effectiveRemoveOne(g.card.name),
                    onRemoveAll: () => onRemoveAll(g.card.name),
                    onMoveOneToSide: () => onMoveOneToSide(g.card.name),
                    onMoveAllToSide: () => onMoveAllToSide(g.card.name),
                    onMoveOneToMaybe: () => onMoveOneToMaybe(g.card.name),
                    onMoveAllToMaybe: () => onMoveAllToMaybe(g.card.name),
                    onShowInfo: onShowInfo ? () => onShowInfo(g.card.name) : undefined,
                    onPickPrint: () => onPickPrint(g.card.name),
                    onToggleFoil: onToggleFoil ? () => onToggleFoil(g.card.name) : undefined,
                    isFoil: !!g.card.foil,
                    customTags,
                    appliedTags: cardTagsByName?.[g.card.name.toLowerCase()],
                    onApplyTag: onApplyCardTag ? (t) => onApplyCardTag(g.card.name, t) : undefined,
                    onRemoveCustomTag,
                    onCreateTag: onCreateAndApplyTag
                      ? (t) => onCreateAndApplyTag(g.card.name, t)
                      : undefined,
                  }}
                />
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}

// ─── Droppable Stack Tag Column ──────────────────────────────────────────────

function DroppableStackTag({
  tag,
  groups,
  cardWidth,
  onAddOne,
  onRemoveOne,
  onRemoveTag,
  onUntagCard,
  selectedCards,
  onSelectCard,
  dragHandleProps,
}: {
  tag: string;
  groups: CardGroup[];
  cardWidth: number;
  onAddOne: (g: CardGroup) => void;
  onRemoveOne: (name: string) => void;
  onRemoveTag: () => void;
  onUntagCard?: (cardName: string, tag: string) => void;
  selectedCards?: Set<string>;
  onSelectCard?: (cardName: string, addToSelection: boolean) => void;
  dragHandleProps?: DragHandleProps;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${DROP_ZONE.TAG_PREFIX}${tag}` });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "shrink-0 rounded-lg transition-colors p-2 -m-1 min-h-[160px]",
        isOver && "bg-primary/10 border-2 border-dashed border-primary/40",
      )}
      style={{ minWidth: cardWidth + 8 }}
    >
      {groups.length > 0 ? (
        <StackColumn
          label={tag}
          sectionId={`tag-${tag}`}
          groups={groups}
          cardWidth={cardWidth}
          onAddOne={onAddOne}
          onRemoveOne={onRemoveOne}
          onUntag={onUntagCard ? (cardName) => onUntagCard(cardName, tag) : undefined}
          selectedCards={selectedCards}
          onSelectCard={onSelectCard}
          dragHandleProps={dragHandleProps}
        />
      ) : (
        <div className="flex flex-col h-full" style={{ width: cardWidth }}>
          <div className="flex items-center gap-1 mb-2">
            {dragHandleProps && (
              <div
                className="shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors touch-none"
                onMouseDown={dragHandleProps.onMouseDown}
              >
                <GripVertical className="h-3.5 w-3.5" />
              </div>
            )}
            <Tag className="h-3 w-3 text-primary/60 shrink-0" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide truncate">
              {tag}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="h-4 w-4 text-destructive shrink-0 ml-auto"
              onClick={onRemoveTag}
            >
              <X className="h-2.5 w-2.5" />
            </Button>
          </div>
          <div className="border-2 border-dashed border-border/40 rounded-lg flex-1 flex items-center justify-center">
            <p className="text-[10px] text-muted-foreground/40 text-center">Drop cards here</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main DeckListView Component ──────────────────────────────────────────────

export interface DeckListViewProps {
  viewMode: ViewMode;
  cardSize: number;
  commanders: DeckCard[];
  deckFormat: string;
  mainSections: Array<SectionDefinition & { groups: CardGroup[] }>;
  otherGroups: CardGroup[];
  sideboardGroups: CardGroup[];
  maybeboardGroups: CardGroup[];
  specialSections: Array<{ id: string; label: string; groups: CardGroup[] }>;
  stackColumns: Array<SectionDefinition & { groups: CardGroup[] }>;
  isOverSide: boolean;
  setSideDropRef: (node: HTMLElement | null) => void;
  isOverMaybe: boolean;
  setMaybeDropRef: (node: HTMLElement | null) => void;
  onAddOne: (g: CardGroup) => void;
  onRemoveOne: (name: string) => void;
  onRemoveAll: (name: string) => void;
  onSetCommander: (card: DeckCard) => void;
  onRemoveCommander: (card?: DeckCard) => void;
  onMoveOneToSide: (name: string) => void;
  onMoveAllToSide: (name: string) => void;
  onMoveOneToMaybe: (name: string) => void;
  onMoveAllToMaybe: (name: string) => void;
  onMoveOneFromSideToMain: (name: string) => void;
  onMoveAllFromSideToMain: (name: string) => void;
  onMoveOneFromSideToMaybe: (name: string) => void;
  onMoveAllFromSideToMaybe: (name: string) => void;
  onMoveOneFromMaybeToMain: (name: string) => void;
  onMoveAllFromMaybeToMain: (name: string) => void;
  onMoveOneFromMaybeToSide: (name: string) => void;
  onMoveAllFromMaybeToSide: (name: string) => void;
  onPickPrint: (name: string) => void;
  onToggleFoil?: (name: string) => void;
  onAddToSide: (card: DeckCard) => void;
  onRemoveFromSide: (name: string) => void;
  onAddToMaybe: (card: DeckCard) => void;
  onRemoveFromMaybe: (name: string) => void;
  totalCards: number;
  customTags?: string[];
  cardTags?: Record<string, string[]>;
  allMainCards?: DeckCard[];
  onUntagCard?: (cardName: string, tag: string) => void;
  onTagCard?: (cardName: string, tag: string) => void;
  onAddCustomTag?: (tag: string) => void;
  onRemoveTag?: (tag: string) => void;
  selectedCards?: Set<string>;
  onSelectCard?: (cardName: string, addToSelection: boolean) => void;
  onSelectAll?: (cardNames: string[]) => void;
  onShowInfo?: (cardName: string) => void;
  coverCardName?: string;
  coverCardFace?: 0 | 1;
  onSetCover?: (card: DeckCard) => void;
  onSetCoverBack?: (card: DeckCard) => void;
  stackPositions?: Record<string, { x: number; y: number }>;
  onStackPositionsChange?: (positions: Record<string, { x: number; y: number }>) => void;
  /** Hover preview wiring (event-delegated via `data-card-name` on the scroll container). */
  onHover?: (card: DeckCard, e: React.MouseEvent) => void;
  onLeave?: () => void;
}

export function DeckListView({
  viewMode,
  cardSize,
  commanders,
  deckFormat,
  mainSections,
  otherGroups,
  sideboardGroups,
  maybeboardGroups,
  specialSections,
  stackColumns,
  isOverSide,
  setSideDropRef,
  isOverMaybe,
  setMaybeDropRef,
  onAddOne,
  onRemoveOne,
  onRemoveAll,
  onSetCommander,
  onRemoveCommander,
  onMoveOneToSide,
  onMoveAllToSide,
  onMoveOneToMaybe,
  onMoveAllToMaybe,
  onMoveOneFromSideToMain,
  onMoveAllFromSideToMain,
  onMoveOneFromSideToMaybe,
  onMoveAllFromSideToMaybe,
  onMoveOneFromMaybeToMain,
  onMoveAllFromMaybeToMain,
  onMoveOneFromMaybeToSide,
  onMoveAllFromMaybeToSide,
  onPickPrint,
  onToggleFoil,
  onAddToSide,
  onRemoveFromSide,
  onAddToMaybe,
  onRemoveFromMaybe,
  totalCards,
  customTags,
  cardTags,
  allMainCards,
  onUntagCard,
  onTagCard,
  onAddCustomTag,
  onRemoveTag,
  selectedCards,
  onSelectCard,
  onSelectAll,
  onShowInfo,
  coverCardName,
  coverCardFace,
  onSetCover,
  onSetCoverBack,
  stackPositions: savedStackPositions,
  onStackPositionsChange,
  onHover,
  onLeave,
}: DeckListViewProps) {
  const cardWidth = CARD_WIDTH_MAP[cardSize] ?? 115;
  const sideboardCount = sideboardGroups.reduce((s, g) => s + g.count, 0);
  const maybeboardCount = maybeboardGroups.reduce((s, g) => s + g.count, 0);

  const containerRef = useRef<HTMLDivElement>(null);

  // Build a name → DeckCard index so the delegated pointer-over handler
  // can resolve the hovered element back to a full card object without
  // every card-render site having to thread an onHover prop.
  const cardsByName = useMemo(() => {
    const m = new Map<string, DeckCard>();
    for (const c of commanders) m.set(c.name, c);
    for (const sec of mainSections) for (const g of sec.groups) m.set(g.card.name, g.card);
    for (const g of otherGroups) m.set(g.card.name, g.card);
    for (const g of sideboardGroups) m.set(g.card.name, g.card);
    for (const g of maybeboardGroups) m.set(g.card.name, g.card);
    for (const sec of specialSections) for (const g of sec.groups) m.set(g.card.name, g.card);
    for (const sec of stackColumns) for (const g of sec.groups) m.set(g.card.name, g.card);
    return m;
  }, [
    commanders,
    mainSections,
    otherGroups,
    sideboardGroups,
    maybeboardGroups,
    specialSections,
    stackColumns,
  ]);

  const handleContainerPointerOver = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!onHover) return;
      const el = (e.target as HTMLElement).closest("[data-card-name]");
      if (!el) return;
      const name = el.getAttribute("data-card-name");
      if (!name) return;
      const card = cardsByName.get(name);
      if (card) onHover(card, e as unknown as React.MouseEvent);
    },
    [onHover, cardsByName],
  );

  const handleContainerPointerOut = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!onLeave) return;
      const from = (e.target as HTMLElement).closest("[data-card-name]");
      const to = (e.relatedTarget as HTMLElement | null)?.closest?.("[data-card-name]");
      if (from && from !== to) onLeave();
    },
    [onLeave],
  );

  const COLUMN_MIN_PX = 18 * 16;
  const COLUMNS_PADDING_PX = 24;
  const [listColumnCount, setListColumnCount] = useState(1);
  const computeColumnCount = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const w = el.clientWidth - COLUMNS_PADDING_PX;
    const n = Math.max(1, Math.floor(w / COLUMN_MIN_PX));
    setListColumnCount((prev) => (prev === n ? prev : n));
  }, [COLUMN_MIN_PX, COLUMNS_PADDING_PX]);
  useLayoutEffect(() => {
    computeColumnCount();
  });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(computeColumnCount);
    ro.observe(el);
    return () => ro.disconnect();
  }, [computeColumnCount]);

  const handleMarqueeComplete = useCallback(
    (rect: { left: number; top: number; width: number; height: number }, additive: boolean) => {
      if (!containerRef.current || !onSelectAll) return;
      // Convert container-local marquee rect to viewport coordinates
      const containerRect = containerRef.current.getBoundingClientRect();
      const mLeft = rect.left + containerRect.left;
      const mTop = rect.top + containerRect.top;
      const mRight = mLeft + rect.width;
      const mBottom = mTop + rect.height;

      const cardEls = containerRef.current.querySelectorAll("[data-card-name]");
      const selected: string[] = [];
      cardEls.forEach((el) => {
        const elRect = el.getBoundingClientRect();
        if (
          elRect.right >= mLeft &&
          elRect.left <= mRight &&
          elRect.bottom >= mTop &&
          elRect.top <= mBottom
        ) {
          const name = el.getAttribute("data-card-name");
          if (name) selected.push(name);
        }
      });
      if (selected.length > 0) {
        onSelectAll(additive ? [...(selectedCards ?? []), ...selected] : selected);
      }
    },
    [onSelectAll, selectedCards],
  );

  const { marqueeRect, handleContainerMouseDown } = useMarquee({
    onMarqueeComplete: handleMarqueeComplete,
    externalContainerRef: containerRef,
  });

  const wrappedHandleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-card-name]")) return;
      // Dragging on empty space starts marquee selection
      handleContainerMouseDown(e);
    },
    [handleContainerMouseDown],
  );

  const applyCardTag = useCallback(
    (cardName: string, tagName: string) => {
      onTagCard?.(cardName, tagName);
    },
    [onTagCard],
  );
  const createAndApplyTag = useCallback(
    (cardName: string, tagName: string) => {
      onAddCustomTag?.(tagName);
      onTagCard?.(cardName, tagName);
    },
    [onAddCustomTag, onTagCard],
  );

  const sharedSectionProps = {
    commanderNames: new Set(commanders.map((c) => c.name)),
    deckFormat,
    viewMode,
    cardWidth,
    onAddOne,
    onRemoveOne,
    onRemoveAll,
    onSetCommander,
    onRemoveCommander,
    onMoveOneToSide,
    onMoveAllToSide,
    onMoveOneToMaybe,
    onMoveAllToMaybe,
    onPickPrint,
    onToggleFoil,
    selectedCards,
    onSelectCard,
    onShowInfo,
    coverCardName,
    coverCardFace,
    onSetCover,
    onSetCoverBack,
    customTags,
    cardTagsByName: cardTags,
    onApplyCardTag: applyCardTag,
    onCreateAndApplyTag: createAndApplyTag,
    onRemoveCustomTag: onRemoveTag,
  };

  const selectionBadge =
    (selectedCards?.size ?? 0) > 0 ? (
      <div className="absolute top-1 right-1 z-40">
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-card/90 border text-selection">
          {selectedCards!.size} selected
        </span>
      </div>
    ) : null;

  const marqueeOverlay = marqueeRect && (
    <div
      className="absolute pointer-events-none border-2 border-dashed border-selection bg-selection/10 z-[9999] rounded"
      style={{
        left: marqueeRect.left,
        top: marqueeRect.top,
        width: marqueeRect.width,
        height: marqueeRect.height,
      }}
    />
  );

  // ─── Stack Section 2D Layout & Reordering ──────────────────────────────────

  // Build natural section IDs
  const naturalSectionIds = useMemo(() => {
    const ids: string[] = [];
    if (commanders.length > 0) ids.push("__commander__");
    for (const col of stackColumns) ids.push(col.id);
    if (customTags && allMainCards) {
      for (const tag of customTags) ids.push(`__tag__${tag}`);
    }
    ids.push("__sideboard__");
    ids.push("__maybeboard__");
    for (const s of specialSections) ids.push(`__special__${s.id}`);
    return ids;
  }, [commanders.length, stackColumns, customTags, allMainCards, specialSections]);

  // ─── Free-position layout: each section has an {x, y} pixel position ────────
  // Snapped to an invisible grid for alignment. Rendered with absolute positioning.
  const GAP = 20;
  const SNAP_W = cardWidth + GAP; // horizontal snap unit
  const SNAP_H = 40; // vertical snap unit (fine-grained)

  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [posVersion, setPosVersion] = useState(0);

  const prevCardWidthRef = useRef(cardWidth);
  if (prevCardWidthRef.current !== cardWidth) {
    const oldSnap = prevCardWidthRef.current + GAP;
    const newSnap = cardWidth + GAP;
    if (positionsRef.current.size > 0 && oldSnap > 0) {
      for (const [id, pos] of positionsRef.current) {
        const col = Math.round(pos.x / oldSnap);
        positionsRef.current.set(id, { x: col * newSnap, y: pos.y });
      }
      setPosVersion((v) => v + 1);
    }
    prevCardWidthRef.current = cardWidth;
  }

  // Sync positions when natural IDs change.
  const prevNaturalRef = useRef<string[]>([]);
  const naturalKey = naturalSectionIds.join(",");
  if (naturalKey !== prevNaturalRef.current.join(",")) {
    prevNaturalRef.current = naturalSectionIds;
    const positions = positionsRef.current;

    // On first load, seed from saved positions if available.
    if (positions.size === 0 && savedStackPositions) {
      for (const [id, pos] of Object.entries(savedStackPositions)) {
        if (naturalSectionIds.includes(id)) {
          positions.set(id, { ...pos });
        }
      }
    }

    // Remove stale.
    for (const id of positions.keys()) {
      if (!naturalSectionIds.includes(id)) positions.delete(id);
    }
    // Place new sections in a row at y=0.
    let nextX = 0;
    for (const pos of positions.values()) {
      nextX = Math.max(nextX, pos.x + SNAP_W);
    }
    for (const id of naturalSectionIds) {
      if (!positions.has(id)) {
        positions.set(id, { x: nextX, y: 0 });
        nextX += SNAP_W;
      }
    }
    // First load with no saved positions: lay out all in a single row.
    if (
      !savedStackPositions &&
      positions.size === naturalSectionIds.length &&
      ![...positions.values()].some((p) => p.y > 0)
    ) {
      naturalSectionIds.forEach((id, i) => positions.set(id, { x: i * SNAP_W, y: 0 }));
    }
    setPosVersion((v) => v + 1);
  }

  // Track section DOM elements and heights via refs (not state) to avoid
  // re-render loops with the ResizeObserver.
  const sectionElRefs = useRef<Map<string, HTMLElement>>(new Map());
  const stackContainerRef = useRef<HTMLDivElement>(null);

  // Drag state
  const [dragSection, setDragSection] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [dropSnap, setDropSnap] = useState<{ x: number; y: number } | null>(null);
  const dropSnapRef = useRef<{ x: number; y: number } | null>(null);
  const [justSnapped, setJustSnapped] = useState(false);

  const snapToGrid = useCallback(
    (px: number, py: number) => ({
      x: Math.max(0, Math.round(px / SNAP_W) * SNAP_W),
      y: Math.max(0, Math.round(py / SNAP_H) * SNAP_H),
    }),
    [SNAP_W],
  );

  const handleGripPointerDown = useCallback(
    (sectionId: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const container = stackContainerRef.current;
      if (!container) return;

      setDragSection(sectionId);
      setDragPos({ x: e.clientX, y: e.clientY });
      setJustSnapped(false);

      const handleMouseMove = (ev: MouseEvent) => {
        ev.preventDefault();
        setDragPos({ x: ev.clientX, y: ev.clientY });

        const cRect = container.getBoundingClientRect();
        const relX = ev.clientX - cRect.left + container.scrollLeft - 12; // padding offset
        const relY = ev.clientY - cRect.top + container.scrollTop - 12;
        const snapped = snapToGrid(relX, relY);
        dropSnapRef.current = snapped;
        setDropSnap(snapped);
      };

      const handleMouseUp = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);

        const snap = dropSnapRef.current;
        if (snap) {
          const positions = positionsRef.current;
          // If another section occupies the snap position, swap with the dragged one.
          const srcPos = positions.get(sectionId);
          for (const [id, pos] of positions) {
            if (id !== sectionId && pos.x === snap.x && pos.y === snap.y && srcPos) {
              positions.set(id, { ...srcPos });
              break;
            }
          }
          positions.set(sectionId, { x: snap.x, y: snap.y });
          setPosVersion((v) => v + 1);
          setJustSnapped(true);
          setTimeout(() => setJustSnapped(false), 300);

          // Persist to deck store.
          if (onStackPositionsChange) {
            const record: Record<string, { x: number; y: number }> = {};
            for (const [id, pos] of positions) record[id] = pos;
            onStackPositionsChange(record);
          }
        }

        setDragSection(null);
        dropSnapRef.current = null;
        setDropSnap(null);
        setDragPos(null);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [snapToGrid, onStackPositionsChange],
  );

  const makeDragHandleProps = useCallback(
    (sectionId: string): DragHandleProps => ({
      onMouseDown: (e: React.MouseEvent) => handleGripPointerDown(sectionId, e),
    }),
    [handleGripPointerDown],
  );

  // ─── Render a single stack section by ID ──────────────────────────────────

  function renderStackSection(
    id: string,
    refCallback: (el: HTMLElement | null) => void,
    posStyle?: React.CSSProperties,
  ) {
    const dhProps = makeDragHandleProps(id);
    const isDragging = dragSection === id;

    const wrapperClass = cn(
      "transition-all duration-200 ease-out",
      isDragging && "opacity-30 scale-95 ring-2 ring-selection/50 rounded-lg",
      justSnapped &&
        !isDragging &&
        "transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
    );

    if (id === "__commander__") {
      return (
        <div key={id} ref={refCallback} className={wrapperClass} style={posStyle}>
          <StackColumn
            label="Commander"
            sectionId="commander"
            groups={commanders.map((c) => ({ card: c, count: 1 }))}
            cardWidth={cardWidth}
            onAddOne={() => {}}
            onRemoveOne={(name) => {
              const c = commanders.find((cmd) => cmd.name === name);
              if (c) onRemoveCommander(c);
            }}
            dragHandleProps={dhProps}
          />
        </div>
      );
    }

    if (id === "__sideboard__") {
      return (
        <div
          key={id}
          ref={(el) => {
            refCallback(el);
            if (el) setSideDropRef(el);
          }}
          className={cn(
            wrapperClass,
            "shrink-0 rounded-lg transition-colors p-2 -m-1 min-h-[100px]",
            isOverSide && "bg-primary/10 border-2 border-dashed border-primary/40",
          )}
          style={{ minWidth: cardWidth + 8, ...posStyle }}
        >
          {sideboardGroups.length > 0 ? (
            <StackColumn
              label="Sideboard"
              sectionId="sideboard"
              groups={sideboardGroups}
              cardWidth={cardWidth}
              onAddOne={(g) => onAddToSide({ ...g.card, id: crypto.randomUUID() })}
              onRemoveOne={onRemoveFromSide}
              dragHandleProps={dhProps}
            />
          ) : (
            <div className="flex flex-col" style={{ width: cardWidth }}>
              <div className="flex items-center gap-1 mb-2">
                <div
                  className="shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors "
                  onMouseDown={dhProps.onMouseDown}
                >
                  <GripVertical className="h-3.5 w-3.5" />
                </div>
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Sideboard
                </span>
              </div>
              <div className="border-2 border-dashed border-border/40 rounded-lg py-4 flex items-center justify-center">
                <p className="text-[10px] text-muted-foreground/40">Drop here</p>
              </div>
            </div>
          )}
        </div>
      );
    }

    if (id === "__maybeboard__") {
      return (
        <div
          key={id}
          ref={(el) => {
            refCallback(el);
            if (el) setMaybeDropRef(el);
          }}
          className={cn(
            wrapperClass,
            "shrink-0 rounded-lg transition-colors p-2 -m-1 min-h-[100px]",
            isOverMaybe && "bg-primary/10 border-2 border-dashed border-primary/40",
          )}
          style={{ minWidth: cardWidth + 8, ...posStyle }}
        >
          {maybeboardGroups.length > 0 ? (
            <StackColumn
              label="Maybeboard"
              sectionId="maybeboard"
              groups={maybeboardGroups}
              cardWidth={cardWidth}
              onAddOne={(g) => onAddToMaybe({ ...g.card, id: crypto.randomUUID() })}
              onRemoveOne={onRemoveFromMaybe}
              dragHandleProps={dhProps}
            />
          ) : (
            <div className="flex flex-col" style={{ width: cardWidth }}>
              <div className="flex items-center gap-1 mb-2">
                <div
                  className="shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors "
                  onMouseDown={dhProps.onMouseDown}
                >
                  <GripVertical className="h-3.5 w-3.5" />
                </div>
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Maybeboard
                </span>
              </div>
              <div className="border-2 border-dashed border-border/40 rounded-lg py-4 flex items-center justify-center">
                <p className="text-[10px] text-muted-foreground/40">Drop here</p>
              </div>
            </div>
          )}
        </div>
      );
    }

    if (id.startsWith("__tag__")) {
      const tag = id.slice("__tag__".length);
      const tagGroups = allMainCards ? getTaggedGroups(tag, allMainCards, cardTags) : [];
      return (
        <div key={id} ref={refCallback} className={wrapperClass} style={posStyle}>
          <DroppableStackTag
            tag={tag}
            groups={tagGroups}
            cardWidth={cardWidth}
            onAddOne={onAddOne}
            onRemoveOne={onRemoveOne}
            onRemoveTag={() => onRemoveTag?.(tag)}
            onUntagCard={onUntagCard ?? undefined}
            selectedCards={selectedCards}
            onSelectCard={onSelectCard}
            dragHandleProps={dhProps}
          />
        </div>
      );
    }

    if (id.startsWith("__special__")) {
      const specialId = id.slice("__special__".length);
      const section = specialSections.find((s) => s.id === specialId);
      if (!section) return null;
      return (
        <div key={id} ref={refCallback} className={wrapperClass} style={posStyle}>
          <StackColumn
            label={section.label}
            sectionId={section.id}
            groups={section.groups}
            cardWidth={cardWidth}
            onAddOne={(g) => onAddToSide({ ...g.card, id: crypto.randomUUID() })}
            onRemoveOne={onRemoveFromSide}
            dragHandleProps={dhProps}
          />
        </div>
      );
    }

    // Regular stack column
    const col = stackColumns.find((c) => c.id === id);
    if (!col) return null;
    return (
      <div key={id} ref={refCallback} className={wrapperClass} style={posStyle}>
        <StackColumn
          label={col.label}
          sectionId={col.id}
          groups={col.groups}
          cardWidth={cardWidth}
          onAddOne={onAddOne}
          onRemoveOne={onRemoveOne}
          selectedCards={selectedCards}
          onSelectCard={onSelectCard}
          onShowInfo={onShowInfo}
          dragHandleProps={dhProps}
        />
      </div>
    );
  }

  // Compute total size needed for the absolute container.
  const containerSize = useMemo(() => {
    let maxX = 0,
      maxY = 0;
    for (const pos of positionsRef.current.values()) {
      maxX = Math.max(maxX, pos.x + SNAP_W);
    }
    // Estimate max Y from positions + a generous section height.
    for (const [id, pos] of positionsRef.current) {
      const el = sectionElRefs.current.get(id);
      const h = el ? el.offsetHeight : 300;
      maxY = Math.max(maxY, pos.y + h + GAP);
    }
    return { width: maxX + GAP, height: maxY + GAP };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posVersion, SNAP_W]);

  if (viewMode === "stack") {
    const positions = positionsRef.current;
    const allPlacements = naturalSectionIds.filter((id) => positions.has(id));

    return (
      <div
        ref={(el) => {
          containerRef.current = el;
          stackContainerRef.current = el;
        }}
        className={cn(
          "h-full overflow-auto relative",
          dragSection && "cursor-grabbing select-none",
        )}
        onMouseDown={wrappedHandleMouseDown}
        onPointerOver={handleContainerPointerOver}
        onPointerOut={handleContainerPointerOut}
      >
        {selectionBadge}
        <div
          className="relative p-3"
          style={{ minWidth: containerSize.width, minHeight: containerSize.height }}
        >
          {allPlacements.map((id) => {
            const pos = positions.get(id)!;
            return renderStackSection(
              id,
              (el) => {
                if (el) sectionElRefs.current.set(id, el);
                else sectionElRefs.current.delete(id);
              },
              {
                position: "absolute",
                left: pos.x,
                top: pos.y,
                width: cardWidth,
                transition:
                  justSnapped && dragSection !== id
                    ? "all 300ms cubic-bezier(0.34,1.56,0.64,1)"
                    : undefined,
              },
            );
          })}

          {/* Drop indicator — ghost outline at snap position */}
          {dropSnap && dragSection && (
            <div
              className="absolute z-[100] pointer-events-none rounded-lg border-2 border-dashed border-selection"
              style={{
                left: dropSnap.x,
                top: dropSnap.y,
                width: cardWidth,
                height: sectionElRefs.current.get(dragSection)?.offsetHeight ?? 100,
                transition: "left 150ms ease-out, top 150ms ease-out",
                boxShadow:
                  "0 0 14px color-mix(in srgb, var(--selection) 50%, transparent), inset 0 0 14px color-mix(in srgb, var(--selection) 10%, transparent)",
              }}
            />
          )}
        </div>

        {/* Drag ghost following cursor */}
        {dragSection && dragPos && (
          <div
            className="fixed z-[200] pointer-events-none bg-selection text-selection-foreground rounded-md px-2.5 py-1 text-xs font-semibold"
            style={{
              left: dragPos.x + 12,
              top: dragPos.y - 8,
              boxShadow: "0 4px 16px color-mix(in srgb, var(--selection) 40%, transparent)",
            }}
          >
            Moving…
          </div>
        )}

        {marqueeOverlay}
      </div>
    );
  }

  return (
    <div className="h-full relative">
      {selectionBadge}
      {marqueeRect && (
        <div
          className="absolute pointer-events-none border-2 border-dashed border-selection bg-selection/10 z-[9999] rounded"
          style={{
            left: marqueeRect.left,
            top: marqueeRect.top,
            width: marqueeRect.width,
            height: marqueeRect.height,
          }}
        />
      )}
      <div
        ref={containerRef}
        className="h-full overflow-y-auto overflow-x-hidden px-3 py-2 relative"
        onMouseDown={wrappedHandleMouseDown}
        onPointerOver={handleContainerPointerOver}
        onPointerOut={handleContainerPointerOut}
      >
        {commanders.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center gap-1 mb-1.5">
              <GameIcon name="overlord-helm" className="h-3 w-3 text-commander shrink-0" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Commander{commanders.length > 1 ? "s" : ""}
              </span>
            </div>
            {viewMode === "list" ? (
              <div className="space-y-0.5">
                {commanders.map((cmd) => (
                  <CardContextMenu
                    key={cmd.id}
                    count={1}
                    location="main"
                    onShowInfo={onShowInfo ? () => onShowInfo(cmd.name) : undefined}
                    onPickPrint={() => onPickPrint(cmd.name)}
                    onToggleFoil={onToggleFoil ? () => onToggleFoil(cmd.name) : undefined}
                    isFoil={!!cmd.foil}
                  >
                    <div
                      className="flex items-center gap-1 group hover:bg-muted/40 rounded px-1 py-0.5 cursor-pointer"
                      onClick={() => onShowInfo?.(cmd.name)}
                    >
                      <GameIcon name="overlord-helm" className="h-3 w-3 text-commander shrink-0" />
                      <span className="text-sm flex-1 truncate">{cmd.name}</span>
                      {cmd.manaCost && (
                        <ManaSymbols cost={cmd.manaCost} size="sm" className="shrink-0" />
                      )}
                      {onSetCover && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className={
                            coverCardName === cmd.name
                              ? "h-5 w-5 text-primary"
                              : "h-5 w-5 text-muted-foreground/40 hover:text-primary transition-colors"
                          }
                          title={
                            coverCardName === cmd.name
                              ? "Remove as deck art cover"
                              : "Set as deck art cover"
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            onSetCover(cmd);
                          }}
                        >
                          <GameIcon name="book-cover" className="h-3 w-3" />
                        </Button>
                      )}
                      {cmd.isDoubleFaced && onSetCoverBack && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className={
                            coverCardName === cmd.name && coverCardFace === 1
                              ? "h-5 w-5 text-primary"
                              : "h-5 w-5 text-muted-foreground/40 hover:text-primary transition-colors"
                          }
                          title={
                            coverCardName === cmd.name && coverCardFace === 1
                              ? "Remove back face as deck art cover"
                              : "Set back face as deck art cover"
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            onSetCoverBack(cmd);
                          }}
                        >
                          <GameIcon
                            name="book-cover"
                            className="h-3 w-3"
                            style={{ transform: "scaleX(-1)" }}
                          />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-5 w-5 text-destructive shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveCommander(cmd);
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContextMenu>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {commanders.map((cmd) => (
                  <div key={cmd.id} className="relative shrink-0" style={{ width: cardWidth }}>
                    <div className="absolute top-1 right-1 z-20 bg-overlay/70 rounded-full p-0.5 shadow">
                      <GameIcon name="overlord-helm" className="h-3.5 w-3.5 text-commander" />
                    </div>
                    <CardVisual
                      group={{ card: cmd, count: 1 }}
                      dragId={`deck-commander-${cmd.name}`}
                      onAddOne={() => {}}
                      onRemoveOne={() => onRemoveCommander(cmd)}
                      onPickPrint={() => onPickPrint(cmd.name)}
                      onShowInfo={onShowInfo ? () => onShowInfo(cmd.name) : undefined}
                      isCover={coverCardName === cmd.name && (coverCardFace ?? 0) === 0}
                      isCoverBack={coverCardName === cmd.name && coverCardFace === 1}
                      onSetCover={onSetCover ? () => onSetCover(cmd) : undefined}
                      onSetCoverBack={
                        cmd.isDoubleFaced && onSetCoverBack ? () => onSetCoverBack(cmd) : undefined
                      }
                      contextLocation="main"
                      contextActions={{
                        onShowInfo: onShowInfo ? () => onShowInfo(cmd.name) : undefined,
                        onPickPrint: () => onPickPrint(cmd.name),
                        onToggleFoil: onToggleFoil ? () => onToggleFoil(cmd.name) : undefined,
                        isFoil: !!cmd.foil,
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {totalCards === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-4xl mb-3 opacity-20">🃏</div>
            <p className="text-sm text-muted-foreground">Drag cards here from the search panel</p>
            <p className="text-xs text-muted-foreground/60 mt-1">or use the + buttons on hover</p>
          </div>
        )}

        {viewMode === "list" ? (
          <>
            <div
              className="w-full gap-4"
              style={{ columnCount: listColumnCount, columnGap: "1rem" }}
            >
              {mainSections.map((s) => (
                <div key={s.id} className="break-inside-avoid">
                  <CardSection
                    label={s.label}
                    groups={s.groups}
                    sectionId={s.id}
                    {...sharedSectionProps}
                  />
                </div>
              ))}
              {otherGroups.length > 0 && (
                <div className="break-inside-avoid">
                  <CardSection
                    label="Other"
                    groups={otherGroups}
                    sectionId="other"
                    {...sharedSectionProps}
                  />
                </div>
              )}
            </div>

            {customTags && customTags.length > 0 && allMainCards && (
              <>
                <div className="border-t border-border/30 my-3" />
                <div style={{ columnCount: listColumnCount, columnGap: "1rem" }}>
                  {customTags.map((tag) => {
                    const tagGroups = getTaggedGroups(tag, allMainCards, cardTags);
                    return (
                      <div key={tag} className="break-inside-avoid">
                        <CardSection
                          label={tag}
                          sectionId={`tag-${tag}`}
                          tag={tag}
                          groups={tagGroups}
                          {...sharedSectionProps}
                          onUntagCard={(cardName) => onUntagCard?.(cardName, tag)}
                          onRemoveTag={() => onRemoveTag?.(tag)}
                        />
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            {mainSections.map((s) => (
              <CardSection
                key={s.id}
                label={s.label}
                groups={s.groups}
                sectionId={s.id}
                {...sharedSectionProps}
              />
            ))}

            {otherGroups.length > 0 && (
              <CardSection
                label="Other"
                groups={otherGroups}
                sectionId="other"
                {...sharedSectionProps}
              />
            )}

            {customTags && customTags.length > 0 && allMainCards && (
              <>
                <div className="border-t border-border/30 my-3" />
                {customTags.map((tag) => {
                  const tagGroups = getTaggedGroups(tag, allMainCards, cardTags);
                  return (
                    <CardSection
                      key={tag}
                      label={tag}
                      sectionId={`tag-${tag}`}
                      tag={tag}
                      groups={tagGroups}
                      {...sharedSectionProps}
                      onUntagCard={(cardName) => onUntagCard?.(cardName, tag)}
                      onRemoveTag={() => onRemoveTag?.(tag)}
                    />
                  );
                })}
              </>
            )}
          </>
        )}

        {/* ── Sideboard ── */}
        <div
          ref={setSideDropRef}
          className={cn(
            "mt-2 rounded-lg border-2 border-dashed transition-colors",
            isOverSide ? "border-primary bg-primary/10" : "border-border/40 hover:border-border/60",
          )}
        >
          <div className="px-2 pt-2 pb-1">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Sideboard ({sideboardCount})
              </span>
            </div>
            {sideboardGroups.length === 0 ? (
              <div className="py-3 text-center">
                <p className="text-xs text-muted-foreground/40">Drop cards here</p>
              </div>
            ) : viewMode === "list" ? (
              <div className="space-y-0.5 pb-1">
                {sideboardGroups.map((g) => (
                  <CardContextMenu
                    key={g.card.name}
                    count={g.count}
                    location="side"
                    onAddOne={() => onAddToSide({ ...g.card, id: crypto.randomUUID() })}
                    onRemoveOne={() => onRemoveFromSide(g.card.name)}
                    onMoveOneToMain={() => onMoveOneFromSideToMain(g.card.name)}
                    onMoveAllToMain={() => onMoveAllFromSideToMain(g.card.name)}
                    onMoveOneToMaybe={() => onMoveOneFromSideToMaybe(g.card.name)}
                    onMoveAllToMaybe={() => onMoveAllFromSideToMaybe(g.card.name)}
                    onShowInfo={onShowInfo ? () => onShowInfo(g.card.name) : undefined}
                    onPickPrint={() => onPickPrint(g.card.name)}
                    onToggleFoil={onToggleFoil ? () => onToggleFoil(g.card.name) : undefined}
                    isFoil={!!g.card.foil}
                    customTags={customTags}
                    appliedTags={cardTags?.[g.card.name.toLowerCase()]}
                    onApplyTag={(t) => applyCardTag(g.card.name, t)}
                    onRemoveCustomTag={onRemoveTag}
                    onCreateTag={(t) => createAndApplyTag(g.card.name, t)}
                  >
                    <DraggableMiniRow
                      dragId={`deck-sideboard-${g.card.name}`}
                      card={g.card}
                      className="flex items-center gap-1 group hover:bg-muted/40 rounded px-1 py-0.5"
                    >
                      <span className="text-xs font-mono w-4 text-right text-muted-foreground shrink-0">
                        {g.count}
                      </span>
                      <span className="text-sm flex-1 truncate">{g.card.name}</span>
                      {g.card.manaCost && (
                        <ManaSymbols cost={g.card.manaCost} size="sm" className="shrink-0" />
                      )}
                      <div className="flex gap-0.5 shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-5 w-5 text-muted-foreground"
                          title="Move 1 to main"
                          onClick={() => onMoveOneFromSideToMain(g.card.name)}
                        >
                          <Upload className="h-3 w-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-5 w-5 text-destructive"
                          title="Remove"
                          onClick={() => onRemoveFromSide(g.card.name)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </DraggableMiniRow>
                  </CardContextMenu>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 pb-1">
                {sideboardGroups.map((g) => (
                  <div key={g.card.name} className="shrink-0" style={{ width: cardWidth }}>
                    <CardVisual
                      group={g}
                      dragId={`deck-sideboard-${g.card.name}`}
                      onAddOne={() => onAddToSide({ ...g.card, id: crypto.randomUUID() })}
                      onRemoveOne={() => onRemoveFromSide(g.card.name)}
                      onPickPrint={() => onPickPrint(g.card.name)}
                      contextLocation="side"
                      contextActions={{
                        onAddOne: () => onAddToSide({ ...g.card, id: crypto.randomUUID() }),
                        onRemoveOne: () => onRemoveFromSide(g.card.name),
                        onMoveOneToMain: () => onMoveOneFromSideToMain(g.card.name),
                        onMoveAllToMain: () => onMoveAllFromSideToMain(g.card.name),
                        onMoveOneToMaybe: () => onMoveOneFromSideToMaybe(g.card.name),
                        onMoveAllToMaybe: () => onMoveAllFromSideToMaybe(g.card.name),
                        onShowInfo: onShowInfo ? () => onShowInfo(g.card.name) : undefined,
                        onPickPrint: () => onPickPrint(g.card.name),
                        onToggleFoil: onToggleFoil ? () => onToggleFoil(g.card.name) : undefined,
                        isFoil: !!g.card.foil,
                        customTags,
                        appliedTags: cardTags?.[g.card.name.toLowerCase()],
                        onApplyTag: (t) => applyCardTag(g.card.name, t),
                        onRemoveCustomTag: onRemoveTag,
                        onCreateTag: (t) => createAndApplyTag(g.card.name, t),
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Maybeboard ── */}
        <div
          ref={setMaybeDropRef}
          className={cn(
            "mt-2 rounded-lg border-2 border-dashed transition-colors",
            isOverMaybe
              ? "border-primary bg-primary/10"
              : "border-border/40 hover:border-border/60",
          )}
        >
          <div className="px-2 pt-2 pb-1">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Maybeboard ({maybeboardCount})
              </span>
              <span className="text-xs text-muted-foreground/40 italic">not in deck</span>
            </div>
            {maybeboardGroups.length === 0 ? (
              <div className="py-3 text-center">
                <p className="text-xs text-muted-foreground/40">Cards you&apos;re considering</p>
              </div>
            ) : viewMode === "list" ? (
              <div className="space-y-0.5 pb-1">
                {maybeboardGroups.map((g) => (
                  <CardContextMenu
                    key={g.card.name}
                    count={g.count}
                    location="maybe"
                    onAddOne={() => onAddToMaybe({ ...g.card, id: crypto.randomUUID() })}
                    onRemoveOne={() => onRemoveFromMaybe(g.card.name)}
                    onMoveOneToMain={() => onMoveOneFromMaybeToMain(g.card.name)}
                    onMoveAllToMain={() => onMoveAllFromMaybeToMain(g.card.name)}
                    onMoveOneToSide={() => onMoveOneFromMaybeToSide(g.card.name)}
                    onMoveAllToSide={() => onMoveAllFromMaybeToSide(g.card.name)}
                    onShowInfo={onShowInfo ? () => onShowInfo(g.card.name) : undefined}
                    onPickPrint={() => onPickPrint(g.card.name)}
                    onToggleFoil={onToggleFoil ? () => onToggleFoil(g.card.name) : undefined}
                    isFoil={!!g.card.foil}
                    customTags={customTags}
                    appliedTags={cardTags?.[g.card.name.toLowerCase()]}
                    onApplyTag={(t) => applyCardTag(g.card.name, t)}
                    onRemoveCustomTag={onRemoveTag}
                    onCreateTag={(t) => createAndApplyTag(g.card.name, t)}
                  >
                    <DraggableMiniRow
                      dragId={`deck-maybeboard-${g.card.name}`}
                      card={g.card}
                      className="flex items-center gap-1 group hover:bg-muted/40 rounded px-1 py-0.5"
                    >
                      <span className="text-xs font-mono w-4 text-right text-muted-foreground shrink-0">
                        {g.count}
                      </span>
                      <span className="text-sm flex-1 truncate text-muted-foreground">
                        {g.card.name}
                      </span>
                      {g.card.manaCost && (
                        <ManaSymbols
                          cost={g.card.manaCost}
                          size="sm"
                          className="shrink-0 opacity-60"
                        />
                      )}
                      <div className="flex gap-0.5 shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-5 w-5 text-muted-foreground"
                          title="Move 1 to main"
                          onClick={() => onMoveOneFromMaybeToMain(g.card.name)}
                        >
                          <Upload className="h-3 w-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-5 w-5 text-destructive"
                          title="Remove"
                          onClick={() => onRemoveFromMaybe(g.card.name)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </DraggableMiniRow>
                  </CardContextMenu>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 pb-1">
                {maybeboardGroups.map((g) => (
                  <div key={g.card.name} className="shrink-0" style={{ width: cardWidth }}>
                    <CardVisual
                      group={g}
                      dragId={`deck-maybeboard-${g.card.name}`}
                      onAddOne={() => onAddToMaybe({ ...g.card, id: crypto.randomUUID() })}
                      onRemoveOne={() => onRemoveFromMaybe(g.card.name)}
                      onPickPrint={() => onPickPrint(g.card.name)}
                      contextLocation="maybe"
                      contextActions={{
                        onAddOne: () => onAddToMaybe({ ...g.card, id: crypto.randomUUID() }),
                        onRemoveOne: () => onRemoveFromMaybe(g.card.name),
                        onMoveOneToMain: () => onMoveOneFromMaybeToMain(g.card.name),
                        onMoveAllToMain: () => onMoveAllFromMaybeToMain(g.card.name),
                        onMoveOneToSide: () => onMoveOneFromMaybeToSide(g.card.name),
                        onMoveAllToSide: () => onMoveAllFromMaybeToSide(g.card.name),
                        onShowInfo: onShowInfo ? () => onShowInfo(g.card.name) : undefined,
                        onPickPrint: () => onPickPrint(g.card.name),
                        onToggleFoil: onToggleFoil ? () => onToggleFoil(g.card.name) : undefined,
                        isFoil: !!g.card.foil,
                        customTags,
                        appliedTags: cardTags?.[g.card.name.toLowerCase()],
                        onApplyTag: (t) => applyCardTag(g.card.name, t),
                        onRemoveCustomTag: onRemoveTag,
                        onCreateTag: (t) => createAndApplyTag(g.card.name, t),
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Special sections (Attractions, Contraptions, Schemes, Planes) ── */}
        {specialSections.map((section) => {
          const count = section.groups.reduce((s, g) => s + g.count, 0);
          return (
            <div
              key={section.id}
              className="mt-2 rounded-lg border-2 border-dashed border-border/40 hover:border-border/60 transition-colors"
            >
              <div className="px-2 pt-2 pb-1">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {section.label} ({count})
                  </span>
                </div>
                {viewMode === "list" ? (
                  <div className="space-y-0.5 pb-1">
                    {section.groups.map((g) => (
                      <div
                        key={g.card.name}
                        className="flex items-center gap-1 group hover:bg-muted/40 rounded px-1 py-0.5"
                      >
                        <span className="text-xs font-mono w-4 text-right text-muted-foreground shrink-0">
                          {g.count}
                        </span>
                        <span className="text-sm flex-1 truncate">{g.card.name}</span>
                        {g.card.manaCost && (
                          <ManaSymbols cost={g.card.manaCost} size="sm" className="shrink-0" />
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-5 w-5 text-destructive shrink-0"
                          title="Remove"
                          onClick={() => onRemoveFromSide(g.card.name)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2 pb-1">
                    {section.groups.map((g) => (
                      <div key={g.card.name} className="shrink-0" style={{ width: cardWidth }}>
                        <CardVisual
                          group={g}
                          dragId={`deck-${section.id}-${g.card.name}`}
                          onAddOne={() => onAddToSide({ ...g.card, id: crypto.randomUUID() })}
                          onRemoveOne={() => onRemoveFromSide(g.card.name)}
                          onPickPrint={() => onPickPrint(g.card.name)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
