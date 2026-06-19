import { Modal } from "@/components/game/modals/Modal";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { manaSymbolUrl, normalizeManaCode } from "@/api/scryfall";
import { ScryfallImg } from "@/components/ScryfallImg";
import { useModalKeyboard } from "@/hooks/useModalKeyboard";
import type { ManaCode } from "@/types/scryfall";
import { MANA_BG_CLASS } from "@/themes/gameTheme";
import type { PromptProps } from "./internal/promptProps";
import type { ChooseColorInput, ChooseColorOutput } from "@/protocol";

const LETTER_BY_NAME: Record<string, string> = {
  White: "W",
  Blue: "U",
  Black: "B",
  Red: "R",
  Green: "G",
  Colorless: "C",
};
const NAME_BY_LETTER: Record<string, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  C: "Colorless",
};

function colorMeta(color: string): { symbol: ManaCode; label: string; bg: string } {
  const letter =
    LETTER_BY_NAME[color] ??
    (color.length === 1 ? color.toUpperCase() : (normalizeManaCode(color[0] ?? "") ?? "C"));
  const symbol = (normalizeManaCode(letter) ?? "C") as ManaCode;
  return {
    symbol,
    label: NAME_BY_LETTER[letter] ?? color,
    bg: MANA_BG_CLASS[letter as keyof typeof MANA_BG_CLASS] ?? "bg-muted",
  };
}

export function ChooseColorModal({
  input,
  respond,
}: PromptProps<ChooseColorInput, ChooseColorOutput>) {
  if (input.amount <= 1) {
    return <SingleColor validColors={input.validColors} respond={respond} />;
  }
  return (
    <ColorCombo
      validColors={input.validColors}
      amount={input.amount}
      repeatAllowed={input.repeatAllowed}
      respond={respond}
    />
  );
}

function SingleColor({
  validColors,
  respond,
}: {
  validColors: string[];
  respond: PromptProps<ChooseColorInput, ChooseColorOutput>["respond"];
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <Modal maxWidth="max-w-sm" maxHeight="" className="outline-none">
      <div ref={dialogRef} tabIndex={-1} className="outline-none" role="dialog" aria-modal="true">
        <Modal.Header>
          <h2 className="font-semibold text-base">Choose a Color</h2>
        </Modal.Header>
        <Modal.Instructions>Click a color to choose it.</Modal.Instructions>
        <div className="p-4 flex flex-wrap gap-3 justify-center">
          {validColors.map((color) => {
            const m = colorMeta(color);
            return (
              <button
                key={color}
                onClick={() => respond({ type: "colorDecision", chosenColors: { [color]: 1 } })}
                className={cn(
                  "flex flex-col items-center gap-1 px-4 py-3 rounded-lg border transition-all",
                  "hover:ring-2 hover:ring-ring hover:scale-105 active:scale-95 text-foreground",
                  m.bg,
                )}
              >
                <ScryfallImg
                  src={manaSymbolUrl(m.symbol)}
                  alt={`{${m.symbol}}`}
                  className="w-10 h-10"
                />
                <span className="text-xs font-semibold">{m.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

function ColorCombo({
  validColors,
  amount,
  repeatAllowed,
  respond,
}: {
  validColors: string[];
  amount: number;
  repeatAllowed: boolean;
  respond: PromptProps<ChooseColorInput, ChooseColorOutput>["respond"];
}) {
  const [counts, setCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(validColors.map((c) => [c, 0])),
  );

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const remaining = amount - total;
  const perColorMax = repeatAllowed ? amount : 1;

  const increment = (color: string) =>
    setCounts((prev) =>
      remaining <= 0 ? prev : { ...prev, [color]: Math.min((prev[color] ?? 0) + 1, perColorMax) },
    );
  const decrement = (color: string) =>
    setCounts((prev) => ({ ...prev, [color]: Math.max((prev[color] ?? 0) - 1, 0) }));

  const confirm = () => {
    const chosen: Record<string, number> = {};
    for (const [color, n] of Object.entries(counts)) if (n > 0) chosen[color] = n;
    respond({ type: "colorDecision", chosenColors: chosen });
  };
  useModalKeyboard({ onSpace: remaining === 0 ? confirm : undefined }, [remaining, confirm]);

  // Running preview of the chosen mana as symbols.
  const preview = Object.entries(counts).flatMap(([color, n]) =>
    Array.from({ length: n }, (_, i) => ({ color, key: `${color}-${i}` })),
  );

  return (
    <Modal maxWidth="max-w-sm" maxHeight="">
      <Modal.Header>
        <h2 className="font-semibold text-base">Choose Colors</h2>
      </Modal.Header>
      <Modal.Instructions>
        {repeatAllowed
          ? `Add ${amount} mana in any combination of colors.`
          : `Choose ${amount} different colors.`}
      </Modal.Instructions>

      <div className="px-4 pt-3 flex items-center justify-between">
        <div className="flex items-center gap-1 min-h-8">
          {preview.length === 0 ? (
            <span className="text-xs text-muted-foreground">Nothing selected yet</span>
          ) : (
            preview.map(({ color, key }) => {
              const m = colorMeta(color);
              return (
                <ScryfallImg
                  key={key}
                  src={manaSymbolUrl(m.symbol)}
                  alt={`{${m.symbol}}`}
                  className="w-7 h-7"
                />
              );
            })
          )}
        </div>
        <span
          className={cn(
            "text-xs font-semibold tabular-nums",
            remaining === 0 ? "text-success" : "text-muted-foreground",
          )}
        >
          {remaining === 0 ? "Ready" : `${remaining} left`}
        </span>
      </div>

      <div className="p-4 flex flex-col gap-2">
        {validColors.map((color) => {
          const m = colorMeta(color);
          const count = counts[color] ?? 0;
          return (
            <div key={color} className="flex items-center gap-3">
              <ScryfallImg
                src={manaSymbolUrl(m.symbol)}
                alt={`{${m.symbol}}`}
                className="w-8 h-8"
              />
              <span
                className={cn("text-sm font-medium w-16 px-2 py-0.5 rounded text-foreground", m.bg)}
              >
                {m.label}
              </span>
              <div className="flex items-center gap-1 ml-auto">
                <button
                  onClick={() => decrement(color)}
                  disabled={count <= 0}
                  className="w-7 h-7 rounded bg-muted hover:bg-muted/80 disabled:opacity-30 text-sm font-bold"
                >
                  −
                </button>
                <span className="w-8 text-center text-sm font-semibold tabular-nums">{count}</span>
                <button
                  onClick={() => increment(color)}
                  disabled={remaining <= 0 || count >= perColorMax}
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
          onClick={confirm}
          disabled={remaining !== 0}
          className={cn(
            "px-4 py-1.5 rounded text-sm font-medium transition-colors",
            remaining !== 0
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
