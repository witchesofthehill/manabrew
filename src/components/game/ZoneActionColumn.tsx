import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { withAlpha } from "@/themes/gameTheme";
import type { GameFontSizes } from "@/themes";
import { useTheme } from "@/hooks/useTheme";
import { LibraryZoneTile } from "@/components/game/zones";
import { CommandZoneTile } from "@/components/game/panels/CommandZoneTile";
import { Card as CardComponent } from "@/components/game/Card";
import type { GameCard } from "@/types/manabrew";
import type { ZonePanelItem } from "@/stores/usePreferencesStore";

export interface ZoneActionColumnProps {
  libraryCount: number;
  /** Full graveyard cards — top card (last element) renders as the tile's art. */
  graveyard?: GameCard[];
  /** Full exile cards — top card (last element) renders as the tile's art. */
  exile?: GameCard[];
  order?: ZonePanelItem[];
  onOpenLibrary?: () => void;
  onOpenGraveyard?: () => void;
  onOpenExile?: () => void;
  hasPlayableInGraveyard?: boolean;
  hasPlayableInExile?: boolean;
  /** Commander cards to render in a leading tile. When absent or empty, no command zone tile is shown. */
  commanders?: GameCard[];
  onOpenCommandZone?: () => void;
  /** Cast the commander on tap (only meaningful for the local player). */
  onCastCommander?: (cardId: string) => void;
  /** Begin a drag-to-cast gesture on the commander card (mirrors the
   *  hand-card drag flow). Local player only. */
  onCommanderDragStart?: (card: GameCard, e: React.MouseEvent) => void;
  /** Id of the card currently being drag-cast — passed through to the
   *  command zone tile so it can render empty while the drag is live. */
  draggingCardId?: string | null;
  /** Hover preview for the commander card. */
  onHoverCard?: (card: GameCard | null, e?: React.MouseEvent) => void;
  /** Layout direction. Defaults to "vertical" for backwards compatibility. */
  orientation?: "vertical" | "horizontal";
  /** Off for opponents so the panel keeps a fixed height the board can reserve. */
  wrap?: boolean;
  /** Horizontal-only: rendered as the first flex item so it wraps
   *  alongside the tiles when the row runs out of width. Used by
   *  `PlayerPanel` to pack the avatar into the same `flex-wrap` as
   *  the zones. */
  leading?: ReactNode;
}

const ZONE_TILE_SIZE = "w-[72px] h-[100px] shrink-0" as const;

function ZoneCardTile({
  count,
  label,
  title,
  topCard,
  onClick,
  onHoverCard,
  highlighted,
  highlightColor,
  fontSizes,
}: {
  count: number;
  label: string;
  title: string;
  topCard?: GameCard;
  onClick?: () => void;
  onHoverCard?: (card: GameCard | null, e?: React.MouseEvent) => void;
  highlighted?: boolean;
  highlightColor: string;
  fontSizes: GameFontSizes;
}) {
  const empty = count === 0 || !topCard;
  if (empty) {
    return (
      <div className="flex flex-col items-center gap-0.5">
        <button
          type="button"
          className={cn(
            "relative h-[100px] w-[72px] overflow-hidden rounded-md border-2 border-dashed text-xs leading-none transition-colors",
            "flex items-center justify-center",
            highlighted && "animate-pulse",
            onClick ? "hover:brightness-110 cursor-pointer" : "opacity-80",
            !highlighted && "border-muted-foreground/45 text-muted-foreground bg-muted/10",
          )}
          style={
            highlighted
              ? {
                  borderColor: highlightColor,
                  backgroundColor: withAlpha(highlightColor, 0.15),
                }
              : undefined
          }
          onClick={onClick}
          disabled={!onClick}
          title={title}
        >
          <span className="font-bold leading-none" style={{ fontSize: fontSizes.zoneCount }}>
            0
          </span>
        </button>
        <span
          className="uppercase tracking-wide text-muted-foreground"
          style={{ fontSize: fontSizes.zoneLabel }}
        >
          {label}
        </span>
      </div>
    );
  }

  const ringStyle: CSSProperties = highlighted ? { boxShadow: `0 0 0 2px ${highlightColor}` } : {};

  return (
    <div
      className="flex flex-col items-center gap-0.5"
      onMouseEnter={onHoverCard ? (e) => onHoverCard(topCard, e) : undefined}
      onMouseLeave={onHoverCard ? () => onHoverCard(null) : undefined}
    >
      <div
        className={cn(
          "relative rounded-md overflow-hidden",
          onClick ? "cursor-pointer hover:brightness-110" : "",
          highlighted && "animate-pulse",
        )}
        style={ringStyle}
        onClick={onClick}
        title={title}
      >
        <CardComponent card={topCard} className={ZONE_TILE_SIZE} />
        <span
          className="absolute bottom-0 left-0 right-0 flex justify-center py-0.5 font-extrabold leading-none tabular-nums text-white pointer-events-none"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.62)", fontSize: fontSizes.zoneCount }}
        >
          {count}
        </span>
      </div>
      <span
        className="uppercase tracking-wide text-muted-foreground"
        style={{ fontSize: fontSizes.zoneLabel }}
      >
        {label}
      </span>
    </div>
  );
}

export function ZoneActionColumn({
  libraryCount,
  graveyard,
  exile,
  order = ["library", "graveyard", "exile"],
  onOpenLibrary,
  onOpenGraveyard,
  onOpenExile,
  hasPlayableInGraveyard,
  hasPlayableInExile,
  commanders,
  onOpenCommandZone,
  onCastCommander,
  onCommanderDragStart,
  draggingCardId,
  onHoverCard,
  orientation = "vertical",
  wrap = true,
  leading,
}: ZoneActionColumnProps) {
  const themeColors = useTheme().gameTheme;
  const fontSizes = useTheme().gameTheme.fontSizes;
  const graveyardTop =
    graveyard && graveyard.length > 0 ? graveyard[graveyard.length - 1] : undefined;
  const exileTop = exile && exile.length > 0 ? exile[exile.length - 1] : undefined;
  const items = {
    library: <LibraryZoneTile key="library" count={libraryCount} onClick={onOpenLibrary} />,
    graveyard: (
      <ZoneCardTile
        key="graveyard"
        count={graveyard?.length ?? 0}
        label="GY"
        title="Graveyard"
        topCard={graveyardTop}
        onClick={onOpenGraveyard}
        onHoverCard={onHoverCard}
        highlighted={hasPlayableInGraveyard}
        highlightColor={themeColors.activeAction.active}
        fontSizes={fontSizes}
      />
    ),
    exile: (
      <ZoneCardTile
        key="exile"
        count={exile?.length ?? 0}
        label="Exile"
        title="Banish"
        topCard={exileTop}
        onClick={onOpenExile}
        onHoverCard={onHoverCard}
        highlighted={hasPlayableInExile}
        highlightColor={themeColors.activeAction.active}
        fontSizes={fontSizes}
      />
    ),
  } as const;

  const isHorizontal = orientation === "horizontal";
  const showCommandZone = (commanders?.length ?? 0) > 0;

  return (
    <div
      className={cn(
        "py-0.5",
        isHorizontal
          ? cn(
              "flex flex-row items-start gap-2.5 min-w-0 pointer-events-auto",
              wrap ? "flex-wrap" : "flex-nowrap",
            )
          : "shrink-0 w-12 flex flex-col items-center gap-1.5 pointer-events-auto",
      )}
    >
      {isHorizontal && leading}
      {showCommandZone && (
        <CommandZoneTile
          commanders={commanders!}
          onCastCommander={onCastCommander}
          onStartDrag={onCommanderDragStart}
          onOpenZone={onOpenCommandZone}
          onHoverCard={onHoverCard}
          draggingCardId={draggingCardId}
        />
      )}
      {order.map((item) => items[item])}
    </div>
  );
}
