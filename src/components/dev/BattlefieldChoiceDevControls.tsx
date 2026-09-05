import type { CardChoiceDto } from "@/protocol/game";
import { cn } from "@/lib/utils";
import { DEV_CARD_CHOICE_KINDS, useGameDevStore } from "@/stores/useGameDevStore";

import {
  DEV_CONTROL_ACTIVE,
  DEV_CONTROL_BUTTON,
  DEV_CONTROL_INACTIVE,
  DEV_SECTION_HEADING,
} from "./devPanel.styles";

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
    <div className="mt-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className={DEV_SECTION_HEADING}>Persistent choices</p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {selected.length === 0 ? "No forced choices" : `${selected.length} forced`}
          </p>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-medium uppercase tracking-wide">
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={selectAll}
          >
            All
          </button>
          {selected.length > 0 ? (
            <button
              type="button"
              className="text-muted-foreground hover:text-destructive"
              onClick={clear}
            >
              Clear all
            </button>
          ) : null}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {DEV_CARD_CHOICE_KINDS.map((kind) => {
          const active = selectedKinds.has(kind);
          return (
            <button
              key={kind}
              type="button"
              className={cn(
                DEV_CONTROL_BUTTON,
                "truncate px-2 py-1.5 text-[10px]",
                active ? DEV_CONTROL_ACTIVE : DEV_CONTROL_INACTIVE,
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
