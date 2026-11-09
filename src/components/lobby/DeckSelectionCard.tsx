import { AlertCircle, Check } from "lucide-react";
import { DeckCardSurface } from "@/components/deck/DeckCardSurface";
import { DeckLabelBadge } from "@/components/deck/DeckLabelBadge";
import { FormatBadge } from "@/components/game/FormatBadge";
import { DeckCoverImage } from "@/components/deck/deckCover";
import {
  getDeckColorCost,
  getDeckNameColorClass,
  getDeckColors,
} from "@/components/deck/deckDisplay.utils";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/useTheme";
import { readableTextColor } from "@/themes/gameTheme";
import type { DeckCard, DeckLabel } from "@/protocol/deck";
import { ScryfallImg } from "@/components/ScryfallImg";
import type { DeckAssignment } from "@/components/lobby/deckSelection.types";
interface DeckSelectionCardProps {
  name: string;
  desc?: string;
  color?: string;
  author?: string;
  cardCount?: number;
  badge?: string | null;
  labels?: DeckLabel[];
  cards: DeckCard[];
  cover: DeckCard | null | undefined;
  coverImageUrl?: string;
  coverFallbackClassName?: string;
  isPreset: boolean;
  isHub?: boolean;
  isSelected: boolean;
  isLegal?: boolean;
  validationError?: string;
  assignments?: DeckAssignment[];
  formatId?: string;
  dense?: boolean;
  isTouch?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onSelect: () => void;
  onActivate?: () => void;
}
function getDeckTypeBreakdown(
  cards: {
    types?: string[];
  }[],
): string {
  if (cards.length === 0) return "Empty deck";
  const creatures = cards.filter((card) => card.types?.includes("Creature")).length;
  const lands = cards.filter((card) => card.types?.includes("Land")).length;
  const spells = cards.length - creatures - lands;
  const parts: string[] = [];
  if (creatures > 0) parts.push(`${creatures} creature${creatures === 1 ? "" : "s"}`);
  if (spells > 0) parts.push(`${spells} spell${spells === 1 ? "" : "s"}`);
  if (lands > 0) parts.push(`${lands} land${lands === 1 ? "" : "s"}`);
  return parts.join(" ·");
}
export function DeckSelectionCard({
  name,
  desc,
  color,
  author,
  cardCount,
  badge,
  labels,
  cards,
  cover,
  coverImageUrl,
  coverFallbackClassName,
  isPreset,
  isHub = false,
  isSelected,
  isLegal = true,
  validationError,
  assignments = [],
  formatId,
  dense,
  isTouch = false,
  disabled = false,
  loading = false,
  onSelect,
  onActivate,
}: DeckSelectionCardProps) {
  const theme = useTheme().gameTheme;
  const colorCost = isHub
    ? (color ?? "")
        .split("")
        .map((letter) => `{${letter}}`)
        .join("")
    : getDeckColorCost(cards);
  const titleColorClass = getDeckNameColorClass(cards, isPreset || isHub ? color : undefined);
  const breakdown = isHub
    ? author
      ? `by ${author}`
      : desc
    : isPreset
      ? desc
      : getDeckTypeBreakdown(cards);
  const fallbackColorLabel = !isPreset && !isHub && getDeckColors(cards).length === 0;
  const showManaRow = !!colorCost || fallbackColorLabel;
  const firstAssignment = assignments[0];
  const hasAssignments = firstAssignment !== undefined;
  const assignmentDescription = hasAssignments
    ? `, assigned to ${assignments.map((assignment) => assignment.label).join(", ")}`
    : isSelected
      ? ", selected"
      : "";
  const assignmentStyle: React.CSSProperties | undefined = firstAssignment
    ? {
        borderColor: firstAssignment.color,
        boxShadow: `0 0 0 1px ${firstAssignment.color}`,
      }
    : undefined;
  return (
    <DeckCardSurface
      title={name}
      ariaLabel={`${name}${assignmentDescription}${isLegal ? "" : ", not legal"}`}
      onOpen={onSelect}
      onDoubleClick={() => {
        if (!isTouch) onActivate?.();
      }}
      disabled={disabled}
      loading={loading}
      pressed={hasAssignments || isSelected}
      titleAttribute={!isLegal ? validationError : undefined}
      className={cn(
        dense && "min-h-40 aspect-auto",
        !dense && "sm:min-h-[172px]",
        !hasAssignments &&
          isSelected &&
          "border-selection-border bg-selection ring-1 ring-selection-border",
        !hasAssignments && !isSelected && !isLegal && "border-warning/50",
      )}
      style={assignmentStyle}
      titleClassName={titleColorClass}
      supportingText={!isLegal ? validationError : !dense ? breakdown : undefined}
      cover={
        coverImageUrl ? (
          <ScryfallImg
            src={coverImageUrl}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <DeckCoverImage cover={cover} alt={name} fallbackClassName={coverFallbackClassName} />
        )
      }
      topRight={
        <div className="pointer-events-none flex items-start gap-1">
          {hasAssignments && (
            <div
              className={cn(
                "grid justify-items-end gap-1",
                assignments.length > 1 && "grid-cols-2",
              )}
            >
              {assignments.map((assignment) => (
                <span
                  key={assignment.id}
                  className="inline-flex h-5 items-center rounded-full px-1.5 text-ui-meta font-semibold whitespace-nowrap"
                  style={{
                    backgroundColor: assignment.color,
                    color: readableTextColor(
                      assignment.color,
                      theme.canvas.shadow,
                      theme.textOnTinted,
                    ),
                  }}
                >
                  {assignment.label}
                </span>
              ))}
            </div>
          )}
          {!hasAssignments && isSelected && (
            <Check
              className={cn(
                "h-3.5 w-3.5",
                cover
                  ? "text-text-on-tinted drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]"
                  : "text-primary",
              )}
            />
          )}
          {!isLegal && (
            <AlertCircle
              className={cn(
                "h-3.5 w-3.5",
                cover
                  ? "text-text-on-tinted drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]"
                  : "text-warning",
              )}
            />
          )}
        </div>
      }
      footer={
        <>
          {formatId && <FormatBadge formatId={formatId} />}
          {showManaRow && (
            <>
              {colorCost ? (
                <ManaSymbols cost={colorCost} size="sm" />
              ) : fallbackColorLabel ? (
                <span
                  className={cn(
                    "text-ui-meta",
                    cover ? "text-text-on-tinted/85" : "text-muted-foreground",
                  )}
                >
                  Colorless
                </span>
              ) : null}
            </>
          )}
          {labels?.map((label) => (
            <DeckLabelBadge key={label.name} label={label} size="sm" />
          ))}
          {!dense && (
            <span className="text-ui-meta text-text-on-tinted/85">
              {isHub
                ? `Community · ${cardCount ?? cards.length} cards`
                : isPreset
                  ? `Preset deck`
                  : `${cards.length} cards`}
            </span>
          )}
          {badge && (
            <Badge variant="outline" className="ml-auto min-h-5 px-1 text-ui-meta">
              {badge}
            </Badge>
          )}
        </>
      }
    />
  );
}
