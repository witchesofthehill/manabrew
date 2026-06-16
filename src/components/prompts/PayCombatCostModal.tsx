import { createPortal } from "react-dom";
import { ManaPool } from "@/components/game/panels/ManaPool";
import { useModalKeyboard } from "@/hooks/useModalKeyboard";
import { useGameStore } from "@/stores/useGameStore";
import type { PromptProps } from "./internal/promptProps";
import type { PayCombatCostInput, PayCombatCostOutput } from "@/protocol";

export function PayCombatCostModal({
  input,
  respond,
}: PromptProps<PayCombatCostInput, PayCombatCostOutput>) {
  const manaPool = useGameStore((s) => s.gameView?.players?.[0]?.manaPool) ?? {};
  const manaPoolTotal = Object.values(manaPool).reduce((a, b) => a + b, 0);
  const canPay = manaPoolTotal >= input.cost;
  const pay = () => respond({ type: "payCombatCost" });
  const decline = () => respond({ type: "declineCombatCost" });
  useModalKeyboard({ onSpace: canPay ? pay : undefined }, [canPay, respond]);

  return createPortal(
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9000] pointer-events-none">
      <div
        className="pointer-events-auto bg-card/95 border border-border rounded-lg p-4 shadow-2xl w-80 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        onKeyDownCapture={(e) => {
          if (e.code === "Space" && e.target instanceof HTMLButtonElement) {
            e.preventDefault();
          }
        }}
      >
        <h2 className="text-sm font-semibold text-foreground mb-1.5">Pay Attack Cost</h2>
        <p className="text-xs text-muted-foreground mb-3">{input.description}</p>
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
          <span>Required:</span>
          <span className="text-foreground font-semibold">{input.cost}</span>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
          <span>Mana in pool:</span>
          <span className={canPay ? "text-success" : "text-destructive"}>
            <ManaPool pool={manaPool} />
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">
          Tap lands on the battlefield to generate mana, then click Pay.
        </p>
        <div className="flex gap-2">
          <button
            className="flex-1 px-3 py-1.5 rounded bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition"
            disabled={!canPay}
            onClick={pay}
          >
            Pay
          </button>
          <button
            className="flex-1 px-3 py-1.5 rounded bg-muted hover:bg-accent text-foreground text-sm font-medium transition-colors"
            onClick={decline}
          >
            Decline
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
