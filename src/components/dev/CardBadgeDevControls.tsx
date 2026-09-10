import {
  hasActiveCardOverride,
  useGameDevStore,
  type DevCardOverrides,
} from "@/stores/useGameDevStore";
import { DevCounterControl } from "./DevCounterControl";
import { DevToggleButton } from "./DevToggleButton";
import { DEV_SECTION, DEV_SECTION_HEADING } from "./devPanel.styles";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
type BoolKey = {
  [K in keyof DevCardOverrides]: DevCardOverrides[K] extends boolean ? K : never;
}[keyof DevCardOverrides];
type NumKey = {
  [K in keyof DevCardOverrides]: DevCardOverrides[K] extends number | null ? K : never;
}[keyof DevCardOverrides];
interface BoolRow {
  key: BoolKey;
  label: string;
}
const STATUS_ROWS: BoolRow[] = [
  {
    key: "forceTapped",
    get label() {
      return i18n._(msg`Tapped`);
    },
  },
  {
    key: "forceSummoningSick",
    get label() {
      return i18n._(msg`Summoning sick`);
    },
  },
  {
    key: "forceExerted",
    get label() {
      return i18n._(msg`Exerted`);
    },
  },
  {
    key: "forceFaceDown",
    get label() {
      return i18n._(msg`Morph (face down)`);
    },
  },
  {
    key: "forceBestowed",
    get label() {
      return i18n._(msg`Bestowed`);
    },
  },
  {
    key: "forceTransformed",
    get label() {
      return i18n._(msg`Transformed`);
    },
  },
  {
    key: "forcePlotted",
    get label() {
      return i18n._(msg`Plotted`);
    },
  },
  {
    key: "forceMadnessExiled",
    get label() {
      return i18n._(msg`Madness`);
    },
  },
  {
    key: "forceWarpExiled",
    get label() {
      return i18n._(msg`Warped`);
    },
  },
  {
    key: "forceCopy",
    get label() {
      return i18n._(msg`Copy`);
    },
  },
  {
    key: "forceToken",
    get label() {
      return i18n._(msg`Token`);
    },
  },
  {
    key: "forceFoil",
    get label() {
      return i18n._(msg`Foil`);
    },
  },
  {
    key: "forcePhasedOut",
    get label() {
      return i18n._(msg`Phased out`);
    },
  },
  {
    key: "forceAttacking",
    get label() {
      return i18n._(msg`Attacking`);
    },
  },
  {
    key: "forcePlayable",
    get label() {
      return i18n._(msg`Playable`);
    },
  },
  {
    key: "forceSelected",
    get label() {
      return i18n._(msg`Selected`);
    },
  },
  {
    key: "forceDoubleFaced",
    get label() {
      return i18n._(msg`Double-faced`);
    },
  },
];
interface NumRow {
  key: NumKey;
  label: string;
}
const COUNTER_ROWS: NumRow[] = [
  { key: "p1p1", label: "+1/+1" },
  { key: "m1m1", label: "−1/−1" },
  {
    key: "loyalty",
    get label() {
      return i18n._(msg`Loyalty`);
    },
  },
  {
    key: "charge",
    get label() {
      return i18n._(msg`Charge`);
    },
  },
  {
    key: "quest",
    get label() {
      return i18n._(msg`Quest`);
    },
  },
  {
    key: "study",
    get label() {
      return i18n._(msg`Study`);
    },
  },
  {
    key: "lore",
    get label() {
      return i18n._(msg`Lore`);
    },
  },
  {
    key: "age",
    get label() {
      return i18n._(msg`Age`);
    },
  },
  {
    key: "time",
    get label() {
      return i18n._(msg`Time`);
    },
  },
  {
    key: "fade",
    get label() {
      return i18n._(msg`Fade`);
    },
  },
  {
    key: "level",
    get label() {
      return i18n._(msg`Level`);
    },
  },
  {
    key: "storage",
    get label() {
      return i18n._(msg`Storage`);
    },
  },
  {
    key: "mining",
    get label() {
      return i18n._(msg`Mining`);
    },
  },
  {
    key: "brick",
    get label() {
      return i18n._(msg`Brick`);
    },
  },
  {
    key: "depletion",
    get label() {
      return i18n._(msg`Depletion`);
    },
  },
  {
    key: "page",
    get label() {
      return i18n._(msg`Page`);
    },
  },
  {
    key: "damage",
    get label() {
      return i18n._(msg`Damage`);
    },
  },
];
export function CardBadgeDevControls() {
  const overrides = useGameDevStore((s) => s.cardOverrides);
  const setOverride = useGameDevStore((s) => s.setCardOverride);
  const reset = useGameDevStore((s) => s.resetCardOverrides);
  const dirty = hasActiveCardOverride(overrides);
  const toggleBool = (key: BoolKey) => setOverride(key, !overrides[key]);
  const bumpNum = (key: NumKey, delta: number) => {
    const curr = overrides[key] ?? 0;
    setOverride(key, Math.max(0, curr + delta));
  };
  return (
    <section className={DEV_SECTION}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className={DEV_SECTION_HEADING}>
            <Trans>Card appearance</Trans>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            <Trans>Force states and counters on the staged card.</Trans>
          </p>
        </div>
        {dirty ? (
          <button
            type="button"
            className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:text-destructive"
            onClick={reset}
          >
            <Trans>Reset card</Trans>
          </button>
        ) : null}
      </div>

      <p className="mb-2 mt-4 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <Trans>States</Trans>
      </p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {STATUS_ROWS.map((row) => (
          <DevToggleButton
            key={row.key}
            label={row.label}
            active={overrides[row.key]}
            onClick={() => toggleBool(row.key)}
          />
        ))}
      </div>

      <p className="mb-2 mt-4 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <Trans>Counters</Trans>
      </p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {COUNTER_ROWS.map((row) => (
          <DevCounterControl
            key={row.key}
            label={row.label}
            value={overrides[row.key]}
            onClear={() => setOverride(row.key, null)}
            onBump={(delta) => bumpNum(row.key, delta)}
          />
        ))}
      </div>
    </section>
  );
}
