import {
  DEFAULT_DEV_PLAYER_OVERRIDES,
  useGameDevStore,
  type DevPlayerOverrides,
} from "@/stores/useGameDevStore";
import { DevCounterControl } from "./DevCounterControl";
import { DevToggleButton } from "./DevToggleButton";
import { DEV_SECTION, DEV_SECTION_HEADING } from "./devPanel.styles";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
type BoolOverrideKey = {
  [K in keyof DevPlayerOverrides]: DevPlayerOverrides[K] extends boolean ? K : never;
}[keyof DevPlayerOverrides];
type NumericOverrideKey = {
  [K in keyof DevPlayerOverrides]: DevPlayerOverrides[K] extends number | null ? K : never;
}[keyof DevPlayerOverrides];
const LIFE_BUMP_BASE = 20;
const NUMERIC_BUMP_BASE = 0;
interface ToggleRow {
  key: BoolOverrideKey;
  label: string;
}
const PLAYER_BADGE_ROWS: ToggleRow[] = [
  {
    key: "forceMonarch",
    get label() {
      return i18n._(msg`Monarch`);
    },
  },
  {
    key: "forceInitiative",
    get label() {
      return i18n._(msg`Initiative`);
    },
  },
  {
    key: "forceCityBlessing",
    get label() {
      return i18n._(msg`City's Blessing`);
    },
  },
  {
    key: "forceEnduringStory",
    get label() {
      return i18n._(msg`Enduring Story`);
    },
  },
];
const PLAYER_STATE_ROWS: ToggleRow[] = [
  {
    key: "forceActiveTurn",
    get label() {
      return i18n._(msg`Active turn`);
    },
  },
  {
    key: "forcePriority",
    get label() {
      return i18n._(msg`Priority`);
    },
  },
  {
    key: "forceTargetable",
    get label() {
      return i18n._(msg`Targetable`);
    },
  },
  {
    key: "forceSelectedTarget",
    get label() {
      return i18n._(msg`Selected`);
    },
  },
  {
    key: "forceFlashing",
    get label() {
      return i18n._(msg`Turn flash`);
    },
  },
  {
    key: "forceEliminated",
    get label() {
      return i18n._(msg`Eliminated`);
    },
  },
  {
    key: "forceDisconnected",
    get label() {
      return i18n._(msg`Disconnected`);
    },
  },
];
interface CounterRow {
  key: NumericOverrideKey;
  label: string;
  base: number;
}
const COUNTER_ROWS: CounterRow[] = [
  {
    key: "poison",
    get label() {
      return i18n._(msg`Poison`);
    },
    base: NUMERIC_BUMP_BASE,
  },
  {
    key: "energy",
    get label() {
      return i18n._(msg`Energy`);
    },
    base: NUMERIC_BUMP_BASE,
  },
  {
    key: "cmdDamage",
    get label() {
      return i18n._(msg`Commander damage`);
    },
    base: NUMERIC_BUMP_BASE,
  },
  {
    key: "radiation",
    get label() {
      return i18n._(msg`Radiation`);
    },
    base: NUMERIC_BUMP_BASE,
  },
  {
    key: "experience",
    get label() {
      return i18n._(msg`Experience`);
    },
    base: NUMERIC_BUMP_BASE,
  },
  {
    key: "ticket",
    get label() {
      return i18n._(msg`Ticket`);
    },
    base: NUMERIC_BUMP_BASE,
  },
  {
    key: "ringLevel",
    get label() {
      return i18n._(msg`Ring`);
    },
    base: NUMERIC_BUMP_BASE,
  },
  {
    key: "speed",
    get label() {
      return i18n._(msg`Speed`);
    },
    base: NUMERIC_BUMP_BASE,
  },
  {
    key: "handCount",
    get label() {
      return i18n._(msg`Hand`);
    },
    base: NUMERIC_BUMP_BASE,
  },
  {
    key: "life",
    get label() {
      return i18n._(msg`Life`);
    },
    base: LIFE_BUMP_BASE,
  },
];
export function PlayerBadgeDevControls() {
  const overrides = useGameDevStore((s) => s.playerOverrides);
  const setOverride = useGameDevStore((s) => s.setPlayerOverride);
  const reset = useGameDevStore((s) => s.resetPlayerOverrides);
  const toggleBool = (key: BoolOverrideKey) => setOverride(key, !overrides[key]);
  const bumpNumeric = (key: NumericOverrideKey, base: number, delta: number) => {
    const curr = overrides[key] ?? base;
    setOverride(key, Math.max(0, curr + delta));
  };
  const dirty = (Object.keys(DEFAULT_DEV_PLAYER_OVERRIDES) as (keyof DevPlayerOverrides)[]).some(
    (key) => overrides[key] !== DEFAULT_DEV_PLAYER_OVERRIDES[key],
  );
  return (
    <section className={DEV_SECTION}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className={DEV_SECTION_HEADING}>
            <Trans>Player HUD</Trans>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            <Trans>Apply the same badge and status checks to every player.</Trans>
          </p>
        </div>
        {dirty ? (
          <button
            type="button"
            className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:text-destructive"
            onClick={reset}
          >
            <Trans>Reset players</Trans>
          </button>
        ) : null}
      </div>

      <p className="mb-2 mt-4 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <Trans>Game badges</Trans>
      </p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {PLAYER_BADGE_ROWS.map((row) => (
          <DevToggleButton
            key={row.key}
            label={row.label}
            active={overrides[row.key]}
            onClick={() => toggleBool(row.key)}
          />
        ))}
      </div>

      <p className="mb-2 mt-4 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <Trans>States</Trans>
      </p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {PLAYER_STATE_ROWS.map((row) => (
          <DevToggleButton
            key={row.key}
            label={row.label}
            active={overrides[row.key]}
            onClick={() => toggleBool(row.key)}
          />
        ))}
      </div>

      <p className="mb-2 mt-4 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <Trans>Values</Trans>
      </p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {COUNTER_ROWS.map((row) => (
          <DevCounterControl
            key={row.key}
            label={row.label}
            value={overrides[row.key]}
            onClear={() => setOverride(row.key, null)}
            onBump={(delta) => bumpNumeric(row.key, row.base, delta)}
          />
        ))}
      </div>
    </section>
  );
}
