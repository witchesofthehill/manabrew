import { AlertCircle, Bot, Check, User } from "lucide-react";
import { DeckLabelBadge } from "@/components/deck/DeckLabelBadge";
import { DeckTileFace, DECK_TILE_PILL_CLASS } from "@/components/deck/DeckTileFace";
import {
  getColorsNameClass,
  getDeckColorCost,
  getDeckNameColorClass,
} from "@/components/deck/deckDisplay.utils";
import { cn } from "@/lib/utils";
import type { DeckCard, DeckLabel } from "@/protocol/deck";

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
  isPreset: boolean;
  isHub?: boolean;
  isSelected: boolean;
  isLegal?: boolean;
  validationError?: string;
  isPlayerDeck?: boolean;
  isOpponentDeck?: boolean;
  formatId?: string;
  dense?: boolean;
  isTouch?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onSelect: () => void;
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
  isPreset,
  isHub = false,
  isSelected,
  isLegal = true,
  validationError,
  isPlayerDeck,
  isOpponentDeck,
  formatId,
  dense,
  isTouch = false,
  disabled = false,
  loading = false,
  onSelect,
  onActivate,
}: DeckSelectionCardProps) {
  const colorCost = isHub
    ? (color ?? "")
        .split("")
        .map((letter) => `{${letter}}`)
        .join("")
    : getDeckColorCost(cards);
  const titleColorClass = isHub
    ? getColorsNameClass(color ?? "")
    : getDeckNameColorClass(cards, isPreset ? color : undefined);
  const footnote = !isLegal
    ? validationError
    : dense || isHub
      ? undefined
      : (desc ?? getDeckTypeBreakdown(cards));
  const hasVsSide = isPlayerDeck || isOpponentDeck;
  const assignment =
    isPlayerDeck && isOpponentDeck
      ? ", assigned to you and the AI"
      : isPlayerDeck
        ? ", assigned to you"
        : isOpponentDeck
          ? ", assigned to the AI"
          : isSelected
            ? ", selected"
            : "";

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
          boxShadow: `0 0 0 2px ${cssVar}`,
        };
      })()
    : undefined;

  return (
    <button
      type="button"
      disabled={disabled}
      aria-busy={loading}
      aria-pressed={Boolean(hasVsSide || isSelected)}
      aria-label={`${name}${assignment}${isLegal ? "" : ", not legal"}`}
      onClick={onSelect}
      onDoubleClick={() => {
        if (!isTouch) onActivate?.();
      }}
      title={!isLegal ? validationError : undefined}
      className={cn(
        "group relative isolate cursor-pointer overflow-hidden rounded-lg border bg-muted text-left transition-all",
        dense ? "h-24" : "aspect-[4/3]",
        "hover:border-primary hover:ring-2 hover:ring-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-wait disabled:opacity-60",
        !hasVsSide && isSelected && "border-primary ring-2 ring-primary",
        !hasVsSide && !isSelected && !isLegal && "border-warning/50",
      )}
      style={sideStyle}
    >
      <DeckTileFace
        title={name}
        titleClassName={titleColorClass}
        subtitle={author ? `by ${author}` : undefined}
        coverUrl={coverImageUrl ?? cover?.uris.art_crop}
        coverAlt={cover?.identity.name ?? name}
        formatId={formatId}
        colorCost={colorCost}
        cardCount={cardCount ?? cards.length}
        dense={dense}
        footnote={footnote}
        footnoteClassName={!isLegal ? "text-warning" : undefined}
        badges={
          <>
            {isPreset && <span className={DECK_TILE_PILL_CLASS}>Official preset</span>}
            {badge && <span className={DECK_TILE_PILL_CLASS}>{badge}</span>}
            {labels?.map((label) => (
              <DeckLabelBadge key={label.name} label={label} size="sm" />
            ))}
          </>
        }
      />

      <span className="absolute right-1.5 top-1.5 z-20 flex items-center gap-1">
        {isPlayerDeck && (
          <span
            className="flex h-5 w-5 items-center justify-center rounded-full text-text-on-tinted"
            style={{ backgroundColor: "var(--player-colors-self)" }}
          >
            <User aria-hidden="true" className="h-3 w-3" />
          </span>
        )}
        {isOpponentDeck && (
          <span
            className="flex h-5 w-5 items-center justify-center rounded-full text-text-on-tinted"
            style={{ backgroundColor: "var(--player-colors-opponent1)" }}
          >
            <Bot aria-hidden="true" className="h-3 w-3" />
          </span>
        )}
        {!hasVsSide && isSelected && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check aria-hidden="true" className="h-3 w-3" />
          </span>
        )}
        {!isLegal && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-background/90 text-warning backdrop-blur-sm">
            <AlertCircle aria-hidden="true" className="h-3 w-3" />
          </span>
        )}
      </span>
    </button>
  );
}
