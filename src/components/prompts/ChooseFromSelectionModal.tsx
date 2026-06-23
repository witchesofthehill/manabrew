import { useCallback, useEffect, useRef, useState } from "react";

import { Modal } from "@/components/game/modals/Modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import { MODAL_INPUT } from "@/components/game/game.styles";
import { cn } from "@/lib/utils";
import { useModalKeyboard } from "@/hooks/useModalKeyboard";
import { PromptPresentation } from "./internal/PromptPresentation";
import type { PromptProps } from "./internal/promptProps";
import type { ChooseFromSelectionInput, ChooseFromSelectionOutput } from "@/protocol";

// Past this many options the button list becomes a type-to-filter field.
const FILTER_THRESHOLD = 5;

export function ChooseFromSelectionModal({
  input,
  respond,
}: PromptProps<ChooseFromSelectionInput, ChooseFromSelectionOutput>) {
  const { options, minChoices, maxChoices, presentation } = input;
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);

  const showFilter = options.length > FILTER_THRESHOLD;
  const visibleOptions = options
    .map((label, idx) => ({ label, idx }))
    .filter(({ label }) => !filter || label.toLowerCase().includes(filter.toLowerCase()));

  useEffect(() => {
    if (showFilter) filterRef.current?.focus();
  }, [showFilter]);

  const isAutoConfirm = minChoices === 1 && maxChoices === 1;
  const showCheckboxes = maxChoices > 1;
  const canConfirm = selected.size >= minChoices && selected.size <= maxChoices;

  const confirm = useCallback(
    (indices: number[]) => respond({ type: "selectionDecision", chosenIndices: indices }),
    [respond],
  );
  const handleConfirm = useCallback(
    () => confirm([...selected].sort((a, b) => a - b)),
    [confirm, selected],
  );

  function toggleOption(idx: number) {
    if (isAutoConfirm) {
      confirm([idx]);
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else if (maxChoices === 1) {
        return new Set([idx]);
      } else if (next.size < maxChoices) {
        next.add(idx);
      }
      return next;
    });
  }

  const spaceConfirms = canConfirm && !isAutoConfirm && !(minChoices === 0 && selected.size === 0);
  useModalKeyboard(
    {
      onEnter: canConfirm && !isAutoConfirm ? handleConfirm : undefined,
      onSpace: spaceConfirms ? handleConfirm : undefined,
    },
    [canConfirm, isAutoConfirm, spaceConfirms, handleConfirm],
  );

  const countHint =
    minChoices === maxChoices ? `Choose ${minChoices}` : `Choose ${minChoices}–${maxChoices}`;

  return (
    <Modal maxWidth="max-w-md" maxHeight="max-h-[50vh]">
      <div className="shrink-0 p-5">
        <PromptPresentation presentation={presentation} />
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
        {visibleOptions.map(({ label, idx }) => {
          const isSelected = selected.has(idx);
          const isDisabled =
            !isAutoConfirm && !isSelected && selected.size >= maxChoices && maxChoices > 1;
          return (
            <button
              key={idx}
              type="button"
              onClick={() => toggleOption(idx)}
              disabled={isDisabled}
              aria-pressed={showCheckboxes ? isSelected : undefined}
              className={cn(
                "group w-full rounded-lg border px-4 py-3 text-left text-sm font-medium transition-all",
                "hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border",
                isSelected
                  ? "border-primary bg-primary/10 ring-1 ring-primary"
                  : "border-border bg-background hover:bg-muted/50",
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
                <span className="leading-tight">
                  <DynamicTextRender text={label} />
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
        <Modal.Footer className="justify-between gap-2">
          <span className="text-xs text-muted-foreground">{countHint}</span>
          <div className="flex items-center gap-2">
            <Badge variant={canConfirm ? "default" : "secondary"} aria-live="polite">
              {selected.size} / {maxChoices}
            </Badge>
            <Button
              size="sm"
              disabled={!canConfirm}
              onClick={handleConfirm}
              className="min-w-[100px]"
            >
              {minChoices === 0 && selected.size === 0
                ? "Skip"
                : `Confirm${selected.size > 0 ? ` (${selected.size})` : ""}`}
            </Button>
          </div>
        </Modal.Footer>
      )}
    </Modal>
  );
}
