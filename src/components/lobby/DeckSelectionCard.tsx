import { AlertCircle, Bot, Check, User } from "lucide-react";
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
import type { DeckCard, DeckLabel } from "@/protocol/deck";
import { ScryfallImg } from "@/components/ScryfallImg";

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
  coverFallbackClassName,
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
          boxShadow: `0 0 0 1px ${cssVar}`,
        };
      })()
    : undefined;

  return (
    <DeckCardSurface
      title={name}
      ariaLabel={`${name}${assignment}${isLegal ? "" : ", not legal"}`}
      onOpen={onSelect}
      onDoubleClick={() => {
        if (!isTouch) onActivate?.();
      }}
      disabled={disabled}
      loading={loading}
      pressed={Boolean(hasVsSide || isSelected)}
      titleAttribute={!isLegal ? validationError : undefined}
      className={cn(
        dense && "h-24 aspect-auto",
        !dense && "sm:min-h-[172px]",
        !hasVsSide && isSelected && "border-primary bg-primary/5 ring-1 ring-primary",
        !hasVsSide && !isSelected && !isLegal && "border-warning/50",
      )}
      style={sideStyle}
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
        <div className="pointer-events-none flex items-center gap-1">
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
                    "text-[10px]",
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
            <span className="text-[10px] text-text-on-tinted/85">
              {isHub
                ? `Community · ${cardCount ?? cards.length} cards`
                : isPreset
                  ? "Preset deck"
                  : `${cards.length} cards`}
            </span>
          )}
          {badge && (
            <Badge variant="outline" className="ml-auto h-4 px-1 text-[9px]">
              {badge}
            </Badge>
          )}
        </>
      }
    />
  );
}
