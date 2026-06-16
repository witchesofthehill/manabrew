import { Modal } from "@/components/game/modals/Modal";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { manaSymbolUrl, normalizeManaCode } from "@/api/scryfall";
import { ScryfallImg } from "@/components/ScryfallImg";
import { useModalKeyboard } from "@/hooks/useModalKeyboard";
import { MANA_BG_CLASS } from "@/themes/gameTheme";
import type { PromptProps } from "./internal/promptProps";
import type { SpecifyManaComboInput, SpecifyManaComboOutput } from "@/protocol";

const LETTER_INFO: Record<string, { label: string; bg: string }> = {
  W: { label: "White", bg: MANA_BG_CLASS.W },
  U: { label: "Blue", bg: MANA_BG_CLASS.U },
  B: { label: "Black", bg: MANA_BG_CLASS.B },
  R: { label: "Red", bg: MANA_BG_CLASS.R },
  G: { label: "Green", bg: MANA_BG_CLASS.G },
  C: { label: "Colorless", bg: MANA_BG_CLASS.C },
};

export function SpecifyManaComboModal({
  input,
  respond,
}: PromptProps<SpecifyManaComboInput, SpecifyManaComboOutput>) {
  const { availableColors, amount } = input;
  const [counts, setCounts] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    for (const c of availableColors) initial[c] = 0;
    // Default: all to first color
    if (availableColors.length > 0) initial[availableColors[0]] = amount;
    return initial;
  });

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const remaining = amount - total;

  const increment = (color: string) => {
    if (remaining <= 0) return;
    setCounts((prev) => ({ ...prev, [color]: (prev[color] ?? 0) + 1 }));
  };

  const decrement = (color: string) => {
    setCounts((prev) => {
      const cur = prev[color] ?? 0;
      if (cur <= 0) return prev;
      return { ...prev, [color]: cur - 1 };
    });
  };

  const handleConfirm = () => {
    const result: string[] = [];
    for (const [color, count] of Object.entries(counts)) {
      for (let i = 0; i < count; i++) result.push(color);
    }
    respond({ type: "manaComboDecision", chosenColors: result });
  };
  useModalKeyboard({ onSpace: remaining === 0 ? handleConfirm : undefined }, [
    remaining,
    handleConfirm,
  ]);

  return (
    <Modal maxWidth="max-w-sm" maxHeight="">
      <Modal.Header>
        <div>
          <h2 className="font-semibold text-base">Choose Mana Colors</h2>
        </div>
      </Modal.Header>

      <Modal.Instructions>
        Distribute {amount} mana across colors. {remaining > 0 ? `${remaining} remaining.` : ""}
      </Modal.Instructions>

      <div className="p-4 flex flex-col gap-2">
        {availableColors.map((color) => {
          const info = LETTER_INFO[color] ?? { label: color, bg: "bg-muted" };
          const symbol = normalizeManaCode(color) ?? "C";
          const count = counts[color] ?? 0;
          return (
            <div key={color} className="flex items-center gap-3">
              <ScryfallImg src={manaSymbolUrl(symbol)} alt={`{${symbol}}`} className="w-8 h-8" />
              <span
                className={cn(
                  "text-sm font-medium w-16 px-2 py-0.5 rounded text-foreground",
                  info.bg,
                )}
              >
                {info.label}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => decrement(color)}
                  disabled={count <= 0}
                  className="w-7 h-7 rounded bg-muted hover:bg-muted/80 disabled:opacity-30 text-sm font-bold"
                >
                  −
                </button>
                <span className="w-8 text-center text-sm font-semibold">{count}</span>
                <button
                  onClick={() => increment(color)}
                  disabled={remaining <= 0}
                  className="w-7 h-7 rounded bg-muted hover:bg-muted/80 disabled:opacity-30 text-sm font-bold"
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-3 border-t flex justify-end">
        <button
          onClick={handleConfirm}
          disabled={remaining > 0}
          className={cn(
            "px-4 py-1.5 rounded text-sm font-medium transition-colors",
            remaining > 0
              ? "bg-muted text-muted-foreground cursor-not-allowed"
              : "bg-primary text-primary-foreground hover:bg-primary/90",
          )}
        >
          Confirm
        </button>
      </div>
    </Modal>
  );
}
