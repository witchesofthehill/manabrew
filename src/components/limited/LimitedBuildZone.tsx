import { Fragment, useEffect } from "react";
import { LimitedCardCanvas } from "@/components/limited/LimitedCardCanvas";
import { LimitedBuildCardRow } from "@/components/limited/LimitedBuildCardRow";
import { CardHoverPreview } from "@/components/game/CardHoverPreview";
import { useCardPreview } from "@/hooks/useCardPreview";
import { cn } from "@/lib/utils";
import type { DraftCard } from "@/types/limited";
import type { BuildGroup, BuildZone } from "@/components/limited/useLimitedBuildStore";
import { peekCard, useScryfallStore } from "@/stores/useScryfallStore";
interface Props {
  id: string;
  visible: boolean;
  title: string;
  zone: BuildZone;
  cards: DraftCard[];
  acquiredIds: readonly string[];
  total: number;
  selectedIds: string[];
  onSelect: (card: DraftCard, additive: boolean) => void;
  onSelectMany: (ids: string[]) => void;
  onMove: (ids: string[], zone: BuildZone) => void;
  onDrop: (card: DraftCard, x: number, y: number) => void;
  group: BuildGroup;
  cardSize: number;
  mode: "gallery" | "list";
  className?: string;
}
export function LimitedBuildZone({
  id,
  visible,
  title,
  zone,
  cards,
  acquiredIds,
  total,
  selectedIds,
  onSelect,
  onSelectMany,
  onMove,
  onDrop,
  group,
  cardSize,
  mode,
  className,
}: Props) {
  const preview = useCardPreview([mode, cards]);
  const { dismiss } = preview;
  useEffect(() => {
    if (!visible) dismiss();
  }, [visible, dismiss]);
  const cache = useScryfallStore((state) => state.cards);
  const labels = cards.map((card) => {
    const info = peekCard(cache, card);
    const type = info?.card_faces?.[0]?.type_line ?? info?.type_line;
    const colors = info?.colors ?? info?.card_faces?.[0]?.colors ?? [];
    if (group === "none") return "";
    if (!info) return "Details pending";
    if (group === "cmc") return type?.includes("Land") ? "Lands" : `Mana value ${info.cmc}`;
    if (group === "color")
      return type?.includes("Land") ? "Lands" : colors.length ? colors.join(" / ") : "Colorless";
    if (group === "type") return type?.split("—")[0].trim() ?? "Unknown type";
    return info.rarity;
  });
  return (
    <section
      id={id}
      data-limited-zone={zone}
      aria-label={title}
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md data-[limited-drop-active=true]:bg-card-selection/10 data-[limited-drop-active=true]:ring-2 data-[limited-drop-active=true]:ring-inset data-[limited-drop-active=true]:ring-card-selection",
        className,
      )}
    >
      {cards.length ? (
        mode === "gallery" ? (
          <LimitedCardCanvas
            cards={cards}
            acquiredIds={acquiredIds}
            selectedIds={selectedIds}
            onSelect={onSelect}
            onSelectMany={visible ? onSelectMany : undefined}
            onActivate={(card) => onMove([card.id], zone === "main" ? "pool" : "main")}
            onDrop={onDrop}
            groupBy={group}
            cardSize={cardSize}
            presentation="columns"
            className="min-h-0 flex-1"
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            <ul className="space-y-1">
              {cards.map((card, index) => (
                <Fragment key={card.id}>
                  {labels[index] && labels[index] !== labels[index - 1] && (
                    <li className="px-2 pt-3 text-xs font-semibold capitalize text-muted-foreground">
                      {labels[index]}
                    </li>
                  )}
                  <LimitedBuildCardRow
                    card={card}
                    selected={selectedIds.includes(card.id)}
                    onSelect={onSelect}
                    onMove={onMove}
                    zone={zone}
                    onInspect={(dto, anchor) =>
                      preview.showSticky(dto, undefined, undefined, anchor)
                    }
                    onHover={(dto, event) =>
                      preview.handleMouseEnter(dto, event, { useAnchor: true, useDelay: true })
                    }
                    onLeave={preview.handleMouseLeave}
                    onDismiss={preview.dismiss}
                  />
                </Fragment>
              ))}
            </ul>
          </div>
        )
      ) : (
        <div className="flex min-h-24 flex-1 items-start justify-center px-2 pt-8">
          <p className="max-w-48 rounded bg-card/40 px-2 py-1 text-center text-xs text-foreground">
            {total
              ? "No cards match your filters."
              : zone === "main"
                ? "Drop cards here to build your Mainboard."
                : zone === "sideboard"
                  ? "Drop cards here to choose your Sideboard."
                  : zone === "maybe"
                    ? "Drop cards here to keep them for later."
                    : "Drop cards here to leave them unassigned."}
          </p>
        </div>
      )}
      <CardHoverPreview preview={preview} />
    </section>
  );
}
