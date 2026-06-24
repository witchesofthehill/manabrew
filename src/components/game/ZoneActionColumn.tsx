import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { withAlpha } from "@/themes/gameTheme";
import type { GameFontSizes } from "@/themes";
import { useTheme } from "@/hooks/useTheme";
import { LibraryZoneTile } from "@/components/game/zones";
import { CommandZoneTile } from "@/components/game/panels/CommandZoneTile";
import { Card as CardComponent } from "@/components/game/Card";
import type { CardDto } from "@/protocol/game";
import type { ZonePanelItem } from "@/stores/usePreferencesStore";

export interface ZoneActionColumnProps {
  libraryCount: number;
  // Last element is the top card, rendered as the tile's art.
  graveyard?: CardDto[];
  exile?: CardDto[];
  order?: ZonePanelItem[];
  onOpenLibrary?: () => void;
  onOpenGraveyard?: () => void;
  onOpenExile?: () => void;
  hasPlayableInGraveyard?: boolean;
  hasPlayableInExile?: boolean;
  hasTargetInGraveyard?: boolean;
  hasTargetInExile?: boolean;
  targetHostile?: boolean;
  commanders?: CardDto[];
  commandPlayableIds?: string[];
  onOpenCommandZone?: () => void;
  onCastCommander?: (cardId: string) => void;
  onCommanderDragStart?: (card: CardDto, e: React.MouseEvent) => void;
  onHoverCard?: (card: CardDto | null, e?: React.MouseEvent) => void;
  orientation?: "vertical" | "horizontal";
  // Horizontal-only: wrap the tiles into this many columns. Overrides `wrap`.
  columns?: number;
  // Off for opponents so the panel keeps a fixed height the board can reserve.
  wrap?: boolean;
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
  topCard?: CardDto;
  onClick?: () => void;
  onHoverCard?: (card: CardDto | null, e?: React.MouseEvent) => void;
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
  hasTargetInGraveyard,
  hasTargetInExile,
  targetHostile,
  commanders,
  commandPlayableIds,
  onOpenCommandZone,
  onCastCommander,
  onCommanderDragStart,
  onHoverCard,
  orientation = "vertical",
  columns,
  wrap = true,
  leading,
}: ZoneActionColumnProps) {
  const themeColors = useTheme().gameTheme;
  const fontSizes = useTheme().gameTheme.fontSizes;
  const targetColor = targetHostile
    ? themeColors.arrow.hostileTarget
    : themeColors.arrow.friendlyTarget;
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
        highlighted={hasPlayableInGraveyard || hasTargetInGraveyard}
        highlightColor={hasTargetInGraveyard ? targetColor : themeColors.activeAction.active}
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
        highlighted={hasPlayableInExile || hasTargetInExile}
        highlightColor={hasTargetInExile ? targetColor : themeColors.activeAction.active}
        fontSizes={fontSizes}
      />
    ),
  } as const;

  const isHorizontal = orientation === "horizontal";
  const showCommandZone = (commanders?.length ?? 0) > 0;

  const columnWidthPx = columns ? columns * 72 + (columns - 1) * 10 : undefined;
  return (
    <div
      className={cn(
        "py-0.5",
        isHorizontal
          ? cn(
              "flex flex-row items-start gap-2.5 min-w-0 pointer-events-auto",
              columns ? "flex-wrap justify-center" : wrap ? "flex-wrap" : "flex-nowrap",
            )
          : "shrink-0 w-fit flex flex-col items-center gap-1.5 pointer-events-auto",
      )}
      style={columnWidthPx ? { maxWidth: columnWidthPx } : undefined}
    >
      {isHorizontal && leading}
      {showCommandZone && (
        <CommandZoneTile
          commanders={commanders!}
          commandPlayableIds={commandPlayableIds}
          onCastCommander={onCastCommander}
          onStartDrag={onCommanderDragStart}
          onOpenZone={onOpenCommandZone}
          onHoverCard={onHoverCard}
        />
      )}
      {order.map((item) => items[item])}
    </div>
  );
}
