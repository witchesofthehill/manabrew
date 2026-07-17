import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";

import { Modal } from "@/components/game/modals/Modal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/game/Card";
import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import { MODAL_INPUT } from "@/components/game/game.styles";
import { cn } from "@/lib/utils";
import { useModalKeyboard } from "@/hooks/useModalKeyboard";
import { PromptPresentation } from "./internal/PromptPresentation";
import { useSourceCardDto } from "./internal/usePromptSourceCard";
import type { PromptProps } from "./internal/promptProps";
import type { ChooseFromSelectionInput, ChooseFromSelectionOutput } from "@/protocol";

// Past this many options the button list becomes a type-to-filter field.
const FILTER_THRESHOLD = 5;

export function ChooseFromSelectionModal({
  input,
  respond,
}: PromptProps<ChooseFromSelectionInput, ChooseFromSelectionOutput>) {
  const { options, minTotal, maxTotal, presentation } = input;
  const sourceCard = useSourceCardDto(presentation.sourceCardId);
  const [counts, setCounts] = useState<Map<number, number>>(new Map());
  const [filter, setFilter] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);

  const showFilter = options.length > FILTER_THRESHOLD;
  const visibleOptions = options
    .map((option, idx) => ({ option, idx }))
    .filter(({ option }) => !filter || option.label.toLowerCase().includes(filter.toLowerCase()));

  useEffect(() => {
    if (showFilter) filterRef.current?.focus();
  }, [showFilter]);

  const total = [...counts].reduce((sum, [idx, count]) => sum + count * options[idx].weight, 0);
  const isAutoConfirm = minTotal === 1 && maxTotal === 1;
  const showCheckboxes = maxTotal > 1;
  const canConfirm = total >= minTotal && total <= maxTotal;

  const confirm = useCallback(
    (indices: number[]) => respond({ type: "selectionDecision", chosenIndices: indices }),
    [respond],
  );
  const handleConfirm = useCallback(() => {
    const indices = [...counts]
      .sort(([a], [b]) => a - b)
      .flatMap(([idx, count]) => Array.from({ length: count }, () => idx));
    confirm(indices);
  }, [confirm, counts]);

  function adjustCount(idx: number, delta: number) {
    setCounts((prev) => {
      const next = new Map(prev);
      const count = Math.max(0, (next.get(idx) ?? 0) + delta);
      if (count === 0) next.delete(idx);
      else next.set(idx, count);
      return next;
    });
  }

  function selectOption(idx: number) {
    if (isAutoConfirm) {
      confirm([idx]);
      return;
    }
    const { weight } = options[idx];
    if (counts.has(idx)) {
      adjustCount(idx, -1);
    } else if (maxTotal === 1) {
      setCounts(new Map([[idx, 1]]));
    } else if (total + weight <= maxTotal) {
      adjustCount(idx, 1);
    }
  }

  const spaceConfirms = canConfirm && !isAutoConfirm && !(minTotal === 0 && total === 0);
  useModalKeyboard(
    {
      onEnter: canConfirm && !isAutoConfirm ? handleConfirm : undefined,
      onSpace: spaceConfirms ? handleConfirm : undefined,
    },
    [canConfirm, isAutoConfirm, spaceConfirms, handleConfirm],
  );

  return (
    <Modal maxWidth="max-w-lg" maxHeight="max-h-[75dvh]">
      {sourceCard && (
        <div className="pointer-events-none absolute top-0 left-full ml-6 drop-shadow-2xl">
          <Card card={sourceCard} bare className="w-[240px]" />
        </div>
      )}
      <div className="shrink-0 p-5">
        <PromptPresentation presentation={{ ...presentation, sourceCardId: undefined }} />
      </div>
      {showFilter && (
        <div className="shrink-0 px-5 pb-2">
          <input
            ref={filterRef}
            type="text"
            placeholder="Type to filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className={MODAL_INPUT}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-5 pb-4">
        {visibleOptions.map(({ option, idx }) => {
          const count = counts.get(idx) ?? 0;
          const isSelected = count > 0;
          const neverAffordable = option.weight > maxTotal;
          const rowClass = cn(
            "w-full rounded-lg border px-4 py-3 text-left text-sm font-medium transition-all",
            isSelected
              ? "border-primary bg-primary/10 ring-1 ring-primary"
              : "border-border bg-background",
            neverAffordable && "opacity-40",
          );

          if (option.canRepeat) {
            const canAdd = !neverAffordable && total + option.weight <= maxTotal;
            return (
              <div key={idx} className={rowClass}>
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 leading-tight">
                    <DynamicTextRender text={option.label} />
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <Button
                      size="icon"
                      variant="outline"
                      aria-label="Remove one"
                      disabled={count === 0}
                      onClick={() => adjustCount(idx, -1)}
                      className="h-7 w-7"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                    <span
                      aria-live="polite"
                      className={cn(
                        "min-w-[1.75rem] text-center tabular-nums",
                        isSelected ? "font-semibold" : "text-muted-foreground",
                      )}
                    >
                      {count}
                    </span>
                    <Button
                      size="icon"
                      variant="outline"
                      aria-label="Add one"
                      disabled={!canAdd}
                      onClick={() => adjustCount(idx, 1)}
                      className="h-7 w-7"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                </div>
              </div>
            );
          }

          const swapsSelection = maxTotal === 1;
          const isDisabled =
            neverAffordable ||
            (!isAutoConfirm && !isSelected && !swapsSelection && total + option.weight > maxTotal);
          return (
            <button
              key={idx}
              type="button"
              onClick={() => selectOption(idx)}
              disabled={isDisabled}
              aria-pressed={showCheckboxes ? isSelected : undefined}
              className={cn(
                rowClass,
                "group",
                "hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border",
                !isSelected && "hover:bg-muted/50",
              )}
            >
              <span className="flex items-start gap-3">
                {showCheckboxes && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-muted-foreground group-hover:border-primary/50",
                    )}
                  >
                    {isSelected && (
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>
                )}
                <span className="min-w-0 flex-1 leading-tight">
                  <DynamicTextRender text={option.label} />
                </span>
              </span>
            </button>
          );
        })}
        {visibleOptions.length === 0 && (
          <p className="px-1 text-sm text-muted-foreground">No matching options.</p>
        )}
      </div>
      {isAutoConfirm ? (
        <div className="px-5 pb-4 pt-2 text-center text-xs text-muted-foreground">
          Click an option to choose it.
        </div>
      ) : (
        <Modal.Footer className="justify-end gap-3">
          {maxTotal > 1 && (
            <span aria-live="polite" className="text-sm tabular-nums text-muted-foreground">
              {total} / {maxTotal}
            </span>
          )}
          <Button
            size="sm"
            disabled={!canConfirm}
            onClick={handleConfirm}
            className="min-w-[100px]"
          >
            {minTotal === 0 && total === 0 ? "Skip" : `Confirm${total > 0 ? ` (${total})` : ""}`}
          </Button>
        </Modal.Footer>
      )}
    </Modal>
  );
}
