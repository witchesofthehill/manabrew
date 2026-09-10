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
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
const PROMPT_LABELS: Record<
  DevPromptActionOverride,
  {
    label: string;
    description: string;
  }
> = {
  chooseAction: {
    get label() {
      return i18n._(msg`Actions`);
    },
    get description() {
      return i18n._(msg`Primary action choices`);
    },
  },
  chooseAttackers: {
    get label() {
      return i18n._(msg`Attackers`);
    },
    get description() {
      return i18n._(msg`Declare attackers state`);
    },
  },
  chooseBlockers: {
    get label() {
      return i18n._(msg`Blockers`);
    },
    get description() {
      return i18n._(msg`Declare blockers state`);
    },
  },
  chooseTargetSpell: {
    get label() {
      return i18n._(msg`Target spell`);
    },
    get description() {
      return i18n._(msg`Spell targeting state`);
    },
  },
  payManaCost: {
    get label() {
      return i18n._(msg`Mana payment`);
    },
    get description() {
      return i18n._(msg`Mana payment state`);
    },
  },
  noAction: {
    get label() {
      return i18n._(msg`No action`);
    },
    get description() {
      return i18n._(msg`No available action state`);
    },
  },
};
export function PromptDevControls() {
  const override = useGameDevStore((s) => s.promptActionOverride);
  const setOverride = useGameDevStore((s) => s.setPromptActionOverride);
  const clearOverride = useGameDevStore((s) => s.clearPromptActionOverride);
  return (
    <section className={DEV_SECTION}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className={DEV_SECTION_HEADING}>
            <Trans>Action view</Trans>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            <Trans>Preview battlefield action states. The engine prompt stays untouched.</Trans>
          </p>
        </div>
        <span className="rounded-full bg-muted px-2 py-1 font-mono text-[10px] text-muted-foreground">
          <Trans>UI only</Trans>
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
          <span className="block">
            <Trans>Follow game</Trans>
          </span>
          <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
            <Trans>Use the live prompt</Trans>
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
