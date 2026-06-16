import { Modal } from "@/components/game/modals/Modal";
import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";
import { manaSymbolUrl, normalizeManaCode } from "@/api/scryfall";
import { ScryfallImg } from "@/components/ScryfallImg";
import type { ManaCode } from "@/types/scryfall";
import { MANA_BG_CLASS } from "@/themes/gameTheme";
import type { PromptProps } from "./internal/promptProps";
import type { ChooseColorInput, ChooseColorOutput } from "@/protocol";

const COLOR_INFO: Record<string, { symbol: ManaCode; bg: string }> = {
  White: { symbol: "W", bg: MANA_BG_CLASS.W },
  Blue: { symbol: "U", bg: MANA_BG_CLASS.U },
  Black: { symbol: "B", bg: MANA_BG_CLASS.B },
  Red: { symbol: "R", bg: MANA_BG_CLASS.R },
  Green: { symbol: "G", bg: MANA_BG_CLASS.G },
  Colorless: { symbol: "C", bg: MANA_BG_CLASS.C },
};

export function ChooseColorModal({
  input,
  respond,
}: PromptProps<ChooseColorInput, ChooseColorOutput>) {
  const { validColors } = input;
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, [validColors]);

  return (
    <Modal maxWidth="max-w-sm" maxHeight="" className="outline-none">
      <div ref={dialogRef} tabIndex={-1} className="outline-none" role="dialog" aria-modal="true">
        <Modal.Header>
          <div>
            <h2 className="font-semibold text-base">Choose a Color</h2>
          </div>
        </Modal.Header>

        <Modal.Instructions>Click a color to choose it.</Modal.Instructions>

        <div className="p-4 flex flex-wrap gap-3 justify-center">
          {validColors.map((color) => {
            const info = COLOR_INFO[color] ?? {
              symbol: normalizeManaCode(color[0] ?? "") ?? "C",
              bg: "bg-muted",
            };
            return (
              <button
                key={color}
                onClick={() => respond({ type: "colorDecision", color })}
                className={cn(
                  "flex flex-col items-center gap-1 px-4 py-3 rounded-lg border transition-all",
                  "hover:ring-2 hover:ring-ring hover:scale-105 active:scale-95",
                  "text-foreground",
                  info.bg,
                )}
              >
                <ScryfallImg
                  src={manaSymbolUrl(info.symbol)}
                  alt={`{${info.symbol}}`}
                  className="w-10 h-10"
                />
                <span className="text-xs font-semibold">{color}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
