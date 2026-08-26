import type { CardChoiceDto } from "@/protocol/game";
import { cn } from "@/lib/utils";
import { DEV_CARD_CHOICE_KINDS, useGameDevStore } from "@/stores/useGameDevStore";

const CHOICE_LABELS: Record<CardChoiceDto["kind"], string> = {
  color: "Color · Black",
  type: "Type · Dragon",
  namedCard: "Named · Black Vise",
  chosenCard: "Cards · 2",
  number: "Number · 7",
  mode: "Mode · Abzan",
  player: "Player · Opponent",
};

export function BattlefieldChoiceDevControls() {
  const selected = useGameDevStore((state) => state.debugCardChoices);
  const toggle = useGameDevStore((state) => state.toggleDebugCardChoice);
  const selectAll = useGameDevStore((state) => state.setAllDebugCardChoices);
  const clear = useGameDevStore((state) => state.clearDebugCardChoices);
  const selectedKinds = new Set(selected.map((choice) => choice.kind));

  return (
    <div className="flex flex-col gap-1.5 border-t border-border/70 pt-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Persistent choices
        </span>
        <span className="flex items-center gap-2 text-[10px] uppercase">
          <button className="text-muted-foreground hover:text-foreground" onClick={selectAll}>
            All
          </button>
          <button className="text-muted-foreground hover:text-destructive" onClick={clear}>
            Clear
          </button>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1">
        {DEV_CARD_CHOICE_KINDS.map((kind) => {
          const active = selectedKinds.has(kind);
          return (
            <button
              key={kind}
              type="button"
              className={cn(
                "truncate rounded border px-1.5 py-1 text-[10px] font-medium",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/70 text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
              onClick={() => toggle(kind)}
              title={CHOICE_LABELS[kind]}
            >
              {CHOICE_LABELS[kind]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
