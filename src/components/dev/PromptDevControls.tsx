import { cn } from "@/lib/utils";
import {
  DEV_PROMPT_ACTION_OVERRIDES,
  type DevPromptActionOverride,
  useGameDevStore,
} from "@/stores/useGameDevStore";

import {
  DEV_CONTROL_ACTIVE,
  DEV_CONTROL_BUTTON,
  DEV_CONTROL_INACTIVE,
  DEV_SECTION,
  DEV_SECTION_HEADING,
} from "./devPanel.styles";

const PROMPT_LABELS: Record<DevPromptActionOverride, { label: string; description: string }> = {
  chooseAction: { label: "Actions", description: "Primary action choices" },
  chooseAttackers: { label: "Attackers", description: "Declare attackers state" },
  chooseBlockers: { label: "Blockers", description: "Declare blockers state" },
  chooseTargetSpell: { label: "Target spell", description: "Spell targeting state" },
  payManaCost: { label: "Mana payment", description: "Mana payment state" },
  noAction: { label: "No action", description: "No available action state" },
};

export function PromptDevControls() {
  const override = useGameDevStore((s) => s.promptActionOverride);
  const setOverride = useGameDevStore((s) => s.setPromptActionOverride);
  const clearOverride = useGameDevStore((s) => s.clearPromptActionOverride);

  return (
    <section className={DEV_SECTION}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className={DEV_SECTION_HEADING}>Action view</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Preview battlefield action states. The engine prompt stays untouched.
          </p>
        </div>
        <span className="rounded-full bg-muted px-2 py-1 font-mono text-[10px] text-muted-foreground">
          UI only
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          className={cn(
            DEV_CONTROL_BUTTON,
            "min-h-14 text-left",
            override == null ? DEV_CONTROL_ACTIVE : DEV_CONTROL_INACTIVE,
          )}
          onClick={clearOverride}
        >
          <span className="block">Follow game</span>
          <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
            Use the live prompt
          </span>
        </button>
        {DEV_PROMPT_ACTION_OVERRIDES.map((promptOverride) => {
          const option = PROMPT_LABELS[promptOverride];
          return (
            <button
              key={promptOverride}
              type="button"
              className={cn(
                DEV_CONTROL_BUTTON,
                "min-h-14 text-left",
                override === promptOverride ? DEV_CONTROL_ACTIVE : DEV_CONTROL_INACTIVE,
              )}
              onClick={() => setOverride(promptOverride)}
            >
              <span className="block">{option.label}</span>
              <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
                {option.description}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
