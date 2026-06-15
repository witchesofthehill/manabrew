import { Card } from "@/components/game/Card";
import { HoverCardPreview } from "@/components/game/HoverCardPreview";
import { useCardPreview } from "@/hooks/useCardPreview";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "./Modal";
import type { GameCard } from "@/types/manabrew";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useModalKeyboard } from "@/hooks/useModalKeyboard";
import { MODAL_CARD_SIZE } from "../game.styles";
import { ModalCardFilter } from "./ModalCardFilter";
import { useCardNameFilter } from "./useCardNameFilter";
import { useTheme } from "@/hooks/useTheme";
import type { CSSProperties } from "react";

export type LibraryPeekMode = "scry" | "surveil" | "dig" | "discard";

interface LibraryPeekModalProps {
  mode: LibraryPeekMode;
  cards: GameCard[];
  /** dig: maximum number of cards the player may take */
  numToTake?: number;
  /** dig: whether taking 0 cards is a valid choice */
  optional?: boolean;
  /** Selected IDs sent back:
   *  scry    → IDs going to the bottom (rest go to top)
   *  surveil → IDs going to the graveyard (rest go to top)
   *  dig     → IDs going to hand (rest go to graveyard)  */
  onConfirm: (selectedIds: string[]) => void;
}

const MODE_CONFIG: Record<
  LibraryPeekMode,
  {
    title: string;
    subtitle: string;
    instructions: string;
    selectedLabel: string;
    unselectedLabel: string;
    confirmLabel: (selected: number, total: number, required?: number) => string;
  }
> = {
  scry: {
    title: "Scry",
    subtitle: "Arrange the top cards of your library",
    instructions: "Click cards you want to put on the bottom. Unselected cards return to the top.",
    selectedLabel: "BOTTOM",
    unselectedLabel: "TOP",
    confirmLabel: (n, t) => `Confirm — ${n} on bottom, ${t - n} on top`,
  },
  surveil: {
    title: "Surveil",
    subtitle: "Choose cards to send to the graveyard",
    instructions:
      "Click cards to send to the graveyard. Unselected cards return to the top of your library.",
    selectedLabel: "GRAVEYARD",
    unselectedLabel: "TOP",
    confirmLabel: (n, t) => `Confirm — ${n} to graveyard, ${t - n} on top`,
  },
  dig: {
    title: "Dig",
    subtitle: "Choose cards to add to your hand",
    instructions: "Select cards to take to your hand. The rest go to the graveyard.",
    selectedLabel: "HAND",
    unselectedLabel: "GRAVEYARD",
    confirmLabel: (n) => `Take ${n} to Hand`,
  },
  discard: {
    title: "Discard",
    subtitle: "Choose cards to discard from your hand",
    instructions: "Click cards to discard them. You must discard the required number.",
    selectedLabel: "DISCARD",
    unselectedLabel: "KEEP",
    confirmLabel: (n, _t, required) =>
      n < (required ?? 0) ? `Select ${(required ?? 0) - n} more to discard` : `Discard ${n}`,
  },
};

export function LibraryPeekModal({
  mode,
  cards,
  numToTake,
  optional,
  onConfirm,
}: LibraryPeekModalProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const preview = useCardPreview();
  const { query, setQuery, filtered, showFilter } = useCardNameFilter(cards);

  const themeColors = useTheme().gameTheme;
  const ringColor = themeColors.cardRing;

  const config = MODE_CONFIG[mode];
  const required = mode === "discard" ? (numToTake ?? 1) : undefined;
  const effectiveRequired =
    mode === "discard" ? Math.min(required ?? cards.length, cards.length) : undefined;
  const max =
    mode === "dig"
      ? (numToTake ?? cards.length)
      : mode === "discard"
        ? (effectiveRequired ?? cards.length)
        : cards.length;
  const canConfirm =
    mode === "dig"
      ? optional || selected.size > 0
      : mode === "discard"
        ? selected.size === effectiveRequired
        : true;

  function toggleCard(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if ((mode === "dig" || mode === "discard") && next.size >= max) return prev;
        next.add(id);
      }
      return next;
    });
  }

  function handleConfirm() {
    onConfirm([...selected]);
  }

  const spaceConfirms = canConfirm && !(mode === "dig" && optional && selected.size === 0);
  useModalKeyboard(
    {
      onEnter: canConfirm ? handleConfirm : undefined,
      onSpace: spaceConfirms ? handleConfirm : undefined,
    },
    [selected, canConfirm, spaceConfirms],
  );

  return (
    <Modal maxWidth="max-w-4xl" maxHeight="max-h-[85vh]">
      <Modal.Header>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-base">{config.title}</h2>
            <p className="text-xs text-muted-foreground">{config.subtitle}</p>
          </div>
          {(mode === "dig" || mode === "discard") && numToTake !== undefined && (
            <Badge variant="secondary">
              {selected.size} / {mode === "discard" ? effectiveRequired : numToTake} selected
            </Badge>
          )}
        </div>
      </Modal.Header>

      <Modal.Instructions>{config.instructions}</Modal.Instructions>

      {showFilter && <ModalCardFilter value={query} onChange={setQuery} />}

      <Modal.Body>
        {cards.length === 0 ? (
          <Modal.EmptyState message="No cards to choose from" />
        ) : filtered.length === 0 ? (
          <Modal.EmptyState message="No matching cards" />
        ) : (
          <div className="flex flex-wrap gap-4 content-start justify-center">
            {filtered.map((card) => {
              const isSelected = selected.has(card.id);
              return (
                <div
                  key={card.id}
                  className="shrink-0 cursor-pointer group flex flex-col items-center gap-1"
                  onMouseEnter={(e) => preview.handleMouseEnter(card, e)}
                  onMouseLeave={preview.handleMouseLeave}
                  onClick={() => toggleCard(card.id)}
                >
                  <Card
                    card={card}
                    className={cn(
                      MODAL_CARD_SIZE,
                      "transition-transform group-hover:scale-105",
                      isSelected && "ring-2",
                    )}
                    style={
                      isSelected ? ({ "--tw-ring-color": ringColor } as CSSProperties) : undefined
                    }
                  />
                  <Badge
                    variant={isSelected ? "default" : "outline"}
                    className="text-[10px] h-4 px-1"
                  >
                    {isSelected ? config.selectedLabel : config.unselectedLabel}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </Modal.Body>

      <Modal.Footer className="justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          {cards.length} card{cards.length !== 1 ? "s" : ""}
          {mode === "dig" && optional && " · Taking 0 is allowed"}
        </div>
        <div className="flex gap-2">
          {/* Select All / Clear helpers for scry and surveil */}
          {mode !== "dig" && mode !== "discard" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelected(new Set(cards.map((c) => c.id)))}
            >
              All to {config.selectedLabel}
            </Button>
          )}
          {mode !== "dig" && mode !== "discard" && selected.size > 0 && (
            <Button variant="outline" size="sm" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          )}
          <Button size="sm" disabled={!canConfirm} onClick={handleConfirm}>
            {config.confirmLabel(selected.size, cards.length, effectiveRequired ?? required)}
          </Button>
        </div>
      </Modal.Footer>

      <HoverCardPreview preview={preview} />
    </Modal>
  );
}
