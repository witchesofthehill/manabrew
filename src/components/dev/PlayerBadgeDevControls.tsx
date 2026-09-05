import {
  DEFAULT_DEV_PLAYER_OVERRIDES,
  useGameDevStore,
  type DevPlayerOverrides,
} from "@/stores/useGameDevStore";

import { DevCounterControl } from "./DevCounterControl";
import { DevToggleButton } from "./DevToggleButton";
import { DEV_SECTION, DEV_SECTION_HEADING } from "./devPanel.styles";

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

const PLAYER_IDENTITY_ROWS: ToggleRow[] = [
  { key: "forceBot", label: "Bot" },
  { key: "forceNoAvatar", label: "Initials avatar" },
];

const PLAYER_BADGE_ROWS: ToggleRow[] = [
  { key: "forceMonarch", label: "Monarch" },
  { key: "forceInitiative", label: "Initiative" },
  { key: "forceCityBlessing", label: "City's Blessing" },
  { key: "forceEnduringStory", label: "Enduring Story" },
];

const PLAYER_STATE_ROWS: ToggleRow[] = [
  { key: "forceActiveTurn", label: "Active turn" },
  { key: "forcePriority", label: "Priority" },
  { key: "forceInCombat", label: "In combat" },
  { key: "forceCombatLethal", label: "Combat lethal" },
  { key: "forceTargetable", label: "Targetable" },
  { key: "forceSelectedTarget", label: "Selected" },
  { key: "forceFlashing", label: "Turn flash" },
  { key: "forceEliminated", label: "Eliminated" },
  { key: "forceDisconnected", label: "Disconnected" },
];

interface CounterRow {
  key: NumericOverrideKey;
  label: string;
  base: number;
}
const MANA_POOL_ROWS: CounterRow[] = [
  { key: "manaWhite", label: "White (W)", base: NUMERIC_BUMP_BASE },
  { key: "manaBlue", label: "Blue (U)", base: NUMERIC_BUMP_BASE },
  { key: "manaBlack", label: "Black (B)", base: NUMERIC_BUMP_BASE },
  { key: "manaRed", label: "Red (R)", base: NUMERIC_BUMP_BASE },
  { key: "manaGreen", label: "Green (G)", base: NUMERIC_BUMP_BASE },
  { key: "manaColorless", label: "Colorless (C)", base: NUMERIC_BUMP_BASE },
];

const COUNTER_ROWS: CounterRow[] = [
  { key: "poison", label: "Poison", base: NUMERIC_BUMP_BASE },
  { key: "energy", label: "Energy", base: NUMERIC_BUMP_BASE },
  { key: "cmdDamage", label: "Commander damage", base: NUMERIC_BUMP_BASE },
  { key: "incomingDamage", label: "Incoming damage", base: NUMERIC_BUMP_BASE },
  { key: "radiation", label: "Radiation", base: NUMERIC_BUMP_BASE },
  { key: "experience", label: "Experience", base: NUMERIC_BUMP_BASE },
  { key: "ticket", label: "Ticket", base: NUMERIC_BUMP_BASE },
  { key: "ringLevel", label: "Ring", base: NUMERIC_BUMP_BASE },
  { key: "speed", label: "Speed", base: NUMERIC_BUMP_BASE },
  { key: "handCount", label: "Hand", base: NUMERIC_BUMP_BASE },
  { key: "life", label: "Life", base: LIFE_BUMP_BASE },
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
          <p className={DEV_SECTION_HEADING}>Player HUD</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Apply the same badge and status checks to every player.
          </p>
        </div>
        {dirty ? (
          <button
            type="button"
            className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:text-destructive"
            onClick={reset}
          >
            Reset players
          </button>
        ) : null}
      </div>

      <p className="mb-2 mt-4 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Identity
      </p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {PLAYER_IDENTITY_ROWS.map((row) => (
          <DevToggleButton
            key={row.key}
            label={row.label}
            active={overrides[row.key]}
            onClick={() => toggleBool(row.key)}
          />
        ))}
      </div>

      <p className="mb-2 mt-4 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Game badges
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
        States
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
        Mana pool
      </p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {MANA_POOL_ROWS.map((row) => (
          <DevCounterControl
            key={row.key}
            label={row.label}
            value={overrides[row.key]}
            onClear={() => setOverride(row.key, null)}
            onBump={(delta) => bumpNumeric(row.key, row.base, delta)}
          />
        ))}
      </div>

      <p className="mb-2 mt-4 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Values
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
