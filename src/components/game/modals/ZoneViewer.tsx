import { cn } from "@/lib/utils";
import type { GameCard } from "@/types/manabrew";
import { Card } from "@/components/game/Card";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { HAND_CARD } from "../game.styles";
import { useCardPreview } from "@/hooks/useCardPreview";
import { HoverCardPreview } from "@/components/game/HoverCardPreview";
import { useTheme } from "@/hooks/useTheme";
import { withAlpha } from "@/themes/gameTheme";
import { Modal } from "./Modal";
import { ModalCardFilter } from "./ModalCardFilter";
import { useCardNameFilter } from "./useCardNameFilter";
import type { CSSProperties } from "react";

interface ZoneViewerProps {
  title: string;
  cards: GameCard[];
  onClose: () => void;
  onClickCard?: (cardId: string) => void;
  clickableCardIds?: string[];
  selectedCardIds?: string[];
  clickLabel?: string;
  selectedLabel?: string;
  /** When targeting, ring the legal targets in the intent colour (red hostile /
   *  blue friendly) instead of the neutral card-ring used for browsing. */
  targetHostile?: boolean;
}

export function ZoneViewer({
  title,
  cards,
  onClose,
  onClickCard,
  clickableCardIds,
  selectedCardIds,
  clickLabel,
  selectedLabel,
  targetHostile,
}: ZoneViewerProps) {
  const preview = useCardPreview();

  const themeColors = useTheme().gameTheme;
  const ringColor =
    targetHostile === undefined
      ? themeColors.cardRing
      : targetHostile
        ? themeColors.arrow.hostileTarget
        : themeColors.arrow.friendlyTarget;
  const clickableIdSet = clickableCardIds ? new Set(clickableCardIds) : null;
  const selectedIdSet = selectedCardIds ? new Set(selectedCardIds) : null;
  const { query, setQuery, filtered, showFilter } = useCardNameFilter(cards);

  return (
    <Modal onClose={onClose}>
      <Modal.Header onClose={onClose}>
        <h2 className="font-semibold text-base">{title}</h2>
      </Modal.Header>

      {showFilter && <ModalCardFilter value={query} onChange={setQuery} autoFocus />}

      <Modal.Body>
        {cards.length === 0 ? (
          <Modal.EmptyState />
        ) : filtered.length === 0 ? (
          <Modal.EmptyState message="No matching cards" />
        ) : (
          <div className="flex flex-wrap gap-2 content-start">
            {filtered.map((card) => {
              const selected = !!selectedIdSet?.has(card.id);
              const clickable =
                !!onClickCard &&
                (selected || clickableIdSet == null || clickableIdSet.has(card.id));
              const cardRingColor = selected ? themeColors.activeAction.active : ringColor;
              const actionLabel = selected ? selectedLabel : clickLabel;
              return (
                <div
                  key={card.id}
                  className="shrink-0 relative flex flex-col gap-1"
                  onMouseEnter={(e) =>
                    preview.handleMouseEnter(card, e, { useDelay: true, useAnchor: true })
                  }
                  onMouseLeave={preview.handleMouseLeave}
                >
                  <Card
                    card={card}
                    className={cn(HAND_CARD, clickable && "ring-2", selected && "opacity-60")}
                    style={
                      clickable
                        ? ({ "--tw-ring-color": cardRingColor } as CSSProperties)
                        : undefined
                    }
                    onClick={clickable ? () => onClickCard!(card.id) : undefined}
                  />
                  {clickable && actionLabel && (
                    <div className="flex items-center justify-center">
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide"
                        style={{
                          color: cardRingColor,
                          backgroundColor: withAlpha(cardRingColor, 0.15),
                        }}
                      >
                        [{actionLabel}]
                      </span>
                    </div>
                  )}
                  {!actionLabel && (card.effectiveManaCost || card.manaCost) && (
                    <div className="min-h-5 flex items-center justify-center">
                      <div className="inline-flex items-center rounded bg-muted/70 px-1.5 py-0.5">
                        <ManaSymbols cost={card.effectiveManaCost ?? card.manaCost} size="sm" />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Modal.Body>

      <HoverCardPreview preview={preview} />
    </Modal>
  );
}
