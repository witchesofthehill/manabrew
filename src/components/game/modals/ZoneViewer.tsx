import { cn } from "@/lib/utils";
import type { GameCard } from "@/types/manabrew";
import { Card } from "@/components/game/Card";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { HAND_CARD } from "../game.styles";
import { useCardPreview } from "@/hooks/useCardPreview";
import { HoverCardPreview } from "@/components/game/HoverCardPreview";
import { useTheme } from "@/hooks/useTheme";
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
              const clickable =
                !!onClickCard && (clickableIdSet == null || clickableIdSet.has(card.id));
              return (
                <div
                  key={card.id}
                  className="shrink-0 relative flex flex-col gap-1"
                  onMouseEnter={(e) => preview.handleMouseEnter(card, e)}
                  onMouseLeave={preview.handleMouseLeave}
                >
                  <Card
                    card={card}
                    className={cn(HAND_CARD, clickable && "ring-2")}
                    style={
                      clickable ? ({ "--tw-ring-color": ringColor } as CSSProperties) : undefined
                    }
                    onClick={clickable ? () => onClickCard!(card.id) : undefined}
                  />
                  {(card.effectiveManaCost || card.manaCost) && (
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
