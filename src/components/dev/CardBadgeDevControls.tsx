import {
  hasActiveCardOverride,
  useGameDevStore,
  type DevCardOverrides,
} from "@/stores/useGameDevStore";

import { DevCounterControl } from "./DevCounterControl";
import { DevToggleButton } from "./DevToggleButton";
import { DEV_SECTION, DEV_SECTION_HEADING } from "./devPanel.styles";

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
  { key: "forceTapped", label: "Tapped" },
  { key: "forceSummoningSick", label: "Summoning sick" },
  { key: "forceExerted", label: "Exerted" },
  { key: "forceFaceDown", label: "Morph (face down)" },
  { key: "forceBestowed", label: "Bestowed" },
  { key: "forceTransformed", label: "Transformed" },
  { key: "forcePlotted", label: "Plotted" },
  { key: "forceMadnessExiled", label: "Madness" },
  { key: "forceWarpExiled", label: "Warped" },
  { key: "forceCopy", label: "Copy" },
  { key: "forceToken", label: "Token" },
  { key: "forceFoil", label: "Foil" },
  { key: "forcePhasedOut", label: "Phased out" },
  { key: "forceAttacking", label: "Attacking" },
  { key: "forcePlayable", label: "Playable" },
  { key: "forceSelected", label: "Selected" },
  { key: "forceDoubleFaced", label: "Double-faced" },
];

interface NumRow {
  key: NumKey;
  label: string;
}

const COUNTER_ROWS: NumRow[] = [
  { key: "p1p1", label: "+1/+1" },
  { key: "m1m1", label: "−1/−1" },
  { key: "loyalty", label: "Loyalty" },
  { key: "charge", label: "Charge" },
  { key: "quest", label: "Quest" },
  { key: "study", label: "Study" },
  { key: "lore", label: "Lore" },
  { key: "age", label: "Age" },
  { key: "time", label: "Time" },
  { key: "fade", label: "Fade" },
  { key: "level", label: "Level" },
  { key: "storage", label: "Storage" },
  { key: "mining", label: "Mining" },
  { key: "brick", label: "Brick" },
  { key: "depletion", label: "Depletion" },
  { key: "page", label: "Page" },
  { key: "damage", label: "Damage" },
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
          <p className={DEV_SECTION_HEADING}>Card appearance</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Force states and counters on the staged card.
          </p>
        </div>
        {dirty ? (
          <button
            type="button"
            className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:text-destructive"
            onClick={reset}
          >
            Reset card
          </button>
        ) : null}
      </div>

      <p className="mb-2 mt-4 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        States
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
        Counters
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
