import { useMemo } from "react";
import type { CardDto } from "@/protocol/game";
import { useTheme } from "@/hooks/useTheme";
import { useGameUIStore } from "@/stores/useGameUIStore";
import { zoneLocationKey, type ZoneLocation, type ZoneViewMode } from "@/lib/zoneView";
import { Modal } from "./Modal";
import { DialogCardBrowser } from "./DialogCardBrowser";

export interface ZoneViewerProps {
  title: string;
  cards: CardDto[];
  mode: ZoneViewMode;
  source?: ZoneLocation;
  totalCount?: number;
  pending?: boolean;
  onClose: () => void;
  onClickCard?: (cardId: string) => void;
  clickableCardIds?: string[];
  selectedCardIds?: string[];
  clickLabel?: string;
  selectedLabel?: string;
  targetHostile?: boolean;
}
const ACTION_LABELS: Record<ZoneViewMode, string> = {
  browse: "Choose action",
  cast: "Choose action",
  target: "Choose this target",
  cost: "Select for cost",
  manual: "Put onto battlefield",
};

export function ZoneViewer({
  title,
  cards,
  mode,
  source,
  totalCount,
  pending,
  onClose,
  onClickCard,
  clickableCardIds,
  selectedCardIds,
  clickLabel,
  selectedLabel,
  targetHostile,
}: ZoneViewerProps) {
  const theme = useTheme().gameTheme;
  const key = zoneLocationKey(source, title);
  const saveState = useGameUIStore((s) => s.saveZoneBrowserState);
  const items = useMemo(() => {
    const legal = new Set(clickableCardIds);
    const selected = new Set(selectedCardIds);
    return cards.map((card) => ({
      id: card.id,
      card,
      selected: selected.has(card.id),
      legal: !!onClickCard && (mode === "manual" || legal.has(card.id) || selected.has(card.id)),
    }));
  }, [cards, mode, onClickCard, clickableCardIds, selectedCardIds]);
  const color =
    targetHostile === undefined
      ? theme.cardRing
      : targetHostile
        ? theme.arrow.hostileTarget
        : theme.arrow.friendlyTarget;
  return (
    <Modal onClose={onClose} maxWidth="max-w-[1280px]" className="max-h-[90dvh]">
      <Modal.Header onClose={onClose}>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">
          {cards.length} visible card{cards.length === 1 ? "" : "s"}
          {totalCount != null && totalCount > cards.length
            ? ` · ${totalCount - cards.length} hidden`
            : ""}
        </p>
      </Modal.Header>
      <DialogCardBrowser
        key={key}
        items={items}
        picker
        activateOnClick={mode !== "manual"}
        pending={pending}
        intentColor={color}
        initialState={useGameUIStore.getState().zoneBrowserStates[key]}
        onStateChange={(state) => saveState(key, state)}
        onActivate={onClickCard ? (item) => onClickCard(item.id) : undefined}
        defaultActionLabel={clickLabel ?? ACTION_LABELS[mode]}
        actionLabel={(item) =>
          item.selected ? (selectedLabel ?? "Undo selection") : (clickLabel ?? ACTION_LABELS[mode])
        }
      />
    </Modal>
  );
}
