import { AlertCircle, Bot, Check, User } from "lucide-react";
import { DeckLabelBadge } from "@/components/deck/DeckLabelBadge";
import { FormatBadge } from "@/components/game/FormatBadge";
import { DeckCoverImage } from "@/components/deck/deckCover";
import {
  DECK_NAME_SHADOW_CLASS,
  getDeckColorCost,
  getDeckNameColorClass,
  getDeckColors,
} from "@/components/deck/deckDisplay.utils";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DeckCard, DeckLabel } from "@/protocol/deck";

interface DeckSelectionCardProps {
  id: string;
  name: string;
  desc?: string;
  color?: string;
  badge?: string | null;
  labels?: DeckLabel[];
  cards: DeckCard[];
  cover: DeckCard | null | undefined;
  coverFallbackClassName?: string;
  isPreset: boolean;
  isSelected: boolean;
  isLegal?: boolean;
  validationError?: string;
  isPlayerDeck?: boolean;
  isOpponentDeck?: boolean;
  formatId?: string;
  dense?: boolean;
  onSelect: () => void;
  /** Double-click to immediately confirm this deck (skip the Select button). */
  onActivate?: () => void;
}

function getDeckTypeBreakdown(cards: { types?: string[] }[]): string {
  if (cards.length === 0) return "Empty deck";
  const creatures = cards.filter((card) => card.types?.includes("Creature")).length;
  const lands = cards.filter((card) => card.types?.includes("Land")).length;
  const spells = cards.length - creatures - lands;
  const parts: string[] = [];
  if (creatures > 0) parts.push(`${creatures} creature${creatures === 1 ? "" : "s"}`);
  if (spells > 0) parts.push(`${spells} spell${spells === 1 ? "" : "s"}`);
  if (lands > 0) parts.push(`${lands} land${lands === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

export function DeckSelectionCard({
  id,
  name,
  desc,
  color,
  badge,
  labels,
  cards,
  cover,
  coverFallbackClassName,
  isPreset,
  isSelected,
  isLegal = true,
  validationError,
  isPlayerDeck,
  isOpponentDeck,
  formatId,
  dense,
  onSelect,
  onActivate,
}: DeckSelectionCardProps) {
  const colorCost = getDeckColorCost(cards);
  const titleColorClass = getDeckNameColorClass(cards, isPreset ? color : undefined);
  const breakdown = isPreset ? desc : getDeckTypeBreakdown(cards);
  const fallbackColorLabel = !isPreset && getDeckColors(cards).length === 0;
  const showManaRow = !!colorCost || fallbackColorLabel;
  const hasVsSide = isPlayerDeck || isOpponentDeck;

  // Derive side-specific inline styles from theme CSS vars
  const sideStyle: React.CSSProperties | undefined = hasVsSide
    ? (() => {
        const bothSides = isPlayerDeck && isOpponentDeck;
        const cssVar = bothSides
          ? "var(--player-colors-opponent1)"
          : isPlayerDeck
            ? "var(--player-colors-self)"
            : "var(--player-colors-opponent1)";
        return {
          borderColor: cssVar,
          boxShadow: `0 0 0 1px ${cssVar}`,
        };
      })()
    : undefined;

  return (
    <button
      key={id}
      type="button"
      onClick={() => {
        if (isLegal) onSelect();
      }}
      onDoubleClick={() => {
        if (isLegal) onActivate?.();
      }}
      disabled={!isLegal}
      title={!isLegal ? validationError : undefined}
      className={cn(
        "relative isolate group rounded-xl border text-left transition-all overflow-hidden bg-muted",
        dense ? "h-24" : "aspect-[4/3] sm:min-h-[172px]",
        "hover:ring-2 hover:ring-primary hover:border-primary",
        isLegal ? "cursor-pointer" : "cursor-not-allowed opacity-50",
        !hasVsSide && isSelected && isLegal
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : !hasVsSide
            ? isLegal
              ? "border-border hover:bg-muted/40 hover:shadow-sm"
              : "border-border"
            : "",
      )}
      style={sideStyle}
    >
      <DeckCoverImage cover={cover} alt={name} fallbackClassName={coverFallbackClassName} />

      <div className="absolute inset-0 z-[1] bg-gradient-to-t from-black/80 via-black/20 to-black/10" />

      <div className="relative z-10 h-full">
        <div className="absolute right-3 top-3 flex items-center gap-1">
          {isPlayerDeck && (
            <span
              className="flex h-5 w-5 items-center justify-center rounded-full text-white"
              style={{ backgroundColor: "var(--player-colors-self)" }}
            >
              <User className="h-3 w-3" />
            </span>
          )}
          {isOpponentDeck && (
            <span
              className="flex h-5 w-5 items-center justify-center rounded-full text-white"
              style={{ backgroundColor: "var(--player-colors-opponent1)" }}
            >
              <Bot className="h-3 w-3" />
            </span>
          )}
          {!hasVsSide && isSelected && (
            <Check
              className={cn(
                "h-3.5 w-3.5",
                cover ? "text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]" : "text-primary",
              )}
            />
          )}
          {!isLegal && (
            <AlertCircle
              className={cn(
                "h-3.5 w-3.5",
                cover ? "text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]" : "text-destructive",
              )}
            />
          )}
        </div>

        <div
          className={cn(
            "absolute inset-x-0 bottom-0 flex flex-col gap-1",
            "px-3 py-1.5 rounded-b-xl bg-black/50 backdrop-blur-sm shadow-[0_-4px_12px_rgba(0,0,0,0.4)]",
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <span
              className={cn(
                "font-semibold text-sm leading-tight line-clamp-2",
                titleColorClass,
                DECK_NAME_SHADOW_CLASS,
              )}
            >
              {name}
            </span>
            {!cover && !hasVsSide && (
              <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
                {isSelected && <Check className="h-3 w-3 text-primary" />}
                {!isLegal && <AlertCircle className="h-3 w-3 text-destructive" />}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 flex-wrap">
            {formatId && <FormatBadge formatId={formatId} />}
            {showManaRow && (
              <>
                {colorCost ? (
                  <ManaSymbols cost={colorCost} size="sm" />
                ) : fallbackColorLabel ? (
                  <span
                    className={cn("text-[10px]", cover ? "text-white/85" : "text-muted-foreground")}
                  >
                    Colorless
                  </span>
                ) : null}
              </>
            )}
            {labels?.map((label) => (
              <DeckLabelBadge key={label.name} label={label} size="sm" />
            ))}
          </div>

          {breakdown && !dense && (
            <p
              className={cn(
                "text-[11px] leading-tight line-clamp-2",
                cover ? "text-white/85" : "text-muted-foreground",
                DECK_NAME_SHADOW_CLASS,
              )}
            >
              {!isLegal ? validationError : breakdown}
            </p>
          )}

          {!dense && (
            <div className="flex items-center gap-1 flex-wrap">
              <span
                className={cn("text-[10px]", cover ? "text-white/85" : "text-muted-foreground")}
              >
                {isPreset ? "Preset deck" : `${cards.length} cards`}
              </span>
              {badge && (
                <Badge variant="outline" className="text-[9px] h-4 px-1 ml-auto">
                  {badge}
                </Badge>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
