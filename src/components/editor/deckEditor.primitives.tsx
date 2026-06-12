/**
 * Shared primitive components for the deck editor views.
 * Extracted to eliminate duplication across DeckListView card components.
 */

import { Button } from "@/components/ui/button";
import { Sparkles, Gem } from "lucide-react";
import { cn } from "@/lib/utils";
import { FoilBadge } from "@/components/limited/FoilBadge";
import { ScryfallImg } from "@/components/ScryfallImg";
import type { OverlayAction } from "./deckEditor.utils";
import type { DeckCard } from "@/types/manabrew";
export type { OverlayAction } from "./deckEditor.utils";

// ─── Card Count Badge ────────────────────────────────────────────────────────

export function CardCountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 1) return null;
  return (
    <div
      className={cn(
        "absolute top-1 left-1 bg-overlay/80 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center border border-white/20",
        className,
      )}
      style={{ zIndex: 10 }}
    >
      {count}
    </div>
  );
}

// ─── Card Thumbnail (image or fallback) ──────────────────────────────────────

export function CardThumbnail({ card }: { card: DeckCard }) {
  return (
    <div className={cn("relative w-full", card.foil && "draft-tile-foil")}>
      <ScryfallImg
        src={card.uris.normal}
        alt={card.name}
        className={cn("w-full rounded-lg border border-border/50 shadow-sm")}
        draggable={false}
      />
      {card.foil && <FoilBadge />}
    </div>
  );
}

// ─── Card Analysis Badges (combo / game changer) ─────────────────────────────

export function CardAnalysisBadges({
  isCombo,
  isGameChanger,
}: {
  isCombo?: boolean;
  isGameChanger?: boolean;
}) {
  if (!isCombo && !isGameChanger) return null;
  return (
    <div className="absolute bottom-1 right-1 z-30 flex gap-0.5">
      {isGameChanger && (
        <div
          className="rounded-full bg-pt-lethal/90 text-white p-0.5 shadow"
          title="Game Changer — restricted to bracket 3+"
        >
          <Gem className="h-3 w-3" />
        </div>
      )}
      {isCombo && (
        <div
          className="rounded-full bg-counter-charge/90 text-white p-0.5 shadow"
          title="Part of a combo in this deck"
        >
          <Sparkles className="h-3 w-3" />
        </div>
      )}
    </div>
  );
}

// ─── Card Hover Overlay ──────────────────────────────────────────────────────

export function CardHoverOverlay({
  actions,
  rounded = "rounded-lg",
  onMouseEnter,
  onMouseLeave,
}: {
  actions: OverlayAction[];
  rounded?: string;
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className={cn(
        "absolute inset-0 bg-overlay/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 pointer-events-none group-hover:pointer-events-auto",
        rounded,
      )}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {actions.map((a) => {
        const Icon = a.icon;
        return (
          <Button
            key={a.label}
            size="sm"
            variant={a.variant === "primary" ? "secondary" : "ghost"}
            className={cn(
              "h-6 w-4/5 text-xs",
              a.variant !== "primary" && "text-white/80 hover:text-white hover:bg-white/10",
            )}
            onClick={(e) => {
              e.stopPropagation();
              a.onClick();
            }}
          >
            <Icon className="h-3 w-3 mr-1" /> {a.label}
          </Button>
        );
      })}
    </div>
  );
}

// ─── Section Header ──────────────────────────────────────────────────────────

export function SectionHeader({
  label,
  count,
  extraContent,
}: {
  label: string;
  count: number;
  extraContent?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5 border-b border-border/40 pb-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-xs text-muted-foreground/60">({count})</span>
      <div className="flex-1" />
      {extraContent}
    </div>
  );
}

// ─── Empty Drop Zone ─────────────────────────────────────────────────────────

export function EmptyDropZone({ message = "Drop cards here" }: { message?: string }) {
  return (
    <div className="border border-dashed border-border/40 rounded py-3 text-center">
      <p className="text-[10px] text-muted-foreground/40">{message}</p>
    </div>
  );
}
