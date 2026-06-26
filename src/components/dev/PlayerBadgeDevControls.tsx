import { cn } from "@/lib/utils";
import {
  DEFAULT_DEV_PLAYER_OVERRIDES,
  useGameDevStore,
  type DevPlayerOverrides,
} from "@/stores/useGameDevStore";

type BoolOverrideKey = {
  [K in keyof DevPlayerOverrides]: DevPlayerOverrides[K] extends boolean ? K : never;
}[keyof DevPlayerOverrides];

type NumericOverrideKey = {
  [K in keyof DevPlayerOverrides]: DevPlayerOverrides[K] extends number | null ? K : never;
}[keyof DevPlayerOverrides];

const LIFE_BUMP_BASE = 20;
const NUMERIC_BUMP_BASE = 0;

/** Dev helper surface that forces every player badge so the operator
 *  can inspect visuals without a live game. Injected into the "Dev" tab
 *  of `RightActionPanel`; overrides flow through `useGameDevStore` and
 *  are folded into the local player's Pixi HUD spec in `GameBoard`. */
export function PlayerBadgeDevControls() {
  const overrides = useGameDevStore((s) => s.playerOverrides);
  const setOverride = useGameDevStore((s) => s.setPlayerOverride);
  const reset = useGameDevStore((s) => s.resetPlayerOverrides);

  const toggleBool = (key: BoolOverrideKey) => setOverride(key, !overrides[key]);

  const bumpNumeric = (key: NumericOverrideKey, base: number, delta: number) => {
    const curr = overrides[key] ?? base;
    const next = Math.max(0, curr + delta);
    setOverride(key, next);
  };

  const dirty =
    overrides.forceMonarch !== DEFAULT_DEV_PLAYER_OVERRIDES.forceMonarch ||
    overrides.forceInitiative !== DEFAULT_DEV_PLAYER_OVERRIDES.forceInitiative ||
    overrides.forceCityBlessing !== DEFAULT_DEV_PLAYER_OVERRIDES.forceCityBlessing ||
    overrides.poison != null ||
    overrides.energy != null ||
    overrides.radiation != null ||
    overrides.ringLevel != null ||
    overrides.speed != null ||
    overrides.cmdDamage != null ||
    overrides.life != null ||
    overrides.handCount != null;

  return (
    <div className="flex flex-col gap-2 mt-2 rounded-md border border-border/70 p-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Player badges (self)
        </span>
        {dirty && (
          <button
            className="text-[10px] uppercase text-muted-foreground hover:text-destructive"
            onClick={reset}
          >
            Reset
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <ToggleButton
          label="Monarch"
          active={overrides.forceMonarch}
          onClick={() => toggleBool("forceMonarch")}
        />
        <ToggleButton
          label="Initiative"
          active={overrides.forceInitiative}
          onClick={() => toggleBool("forceInitiative")}
        />
        <ToggleButton
          label="City's Blessing"
          active={overrides.forceCityBlessing}
          onClick={() => toggleBool("forceCityBlessing")}
        />
      </div>

      <BadgeCounter
        label="Poison"
        value={overrides.poison}
        onChange={(v) => setOverride("poison", v)}
        onBump={(d) => bumpNumeric("poison", NUMERIC_BUMP_BASE, d)}
      />
      <BadgeCounter
        label="Energy"
        value={overrides.energy}
        onChange={(v) => setOverride("energy", v)}
        onBump={(d) => bumpNumeric("energy", NUMERIC_BUMP_BASE, d)}
      />
      <BadgeCounter
        label="Cmd dmg"
        value={overrides.cmdDamage}
        onChange={(v) => setOverride("cmdDamage", v)}
        onBump={(d) => bumpNumeric("cmdDamage", NUMERIC_BUMP_BASE, d)}
      />
      <BadgeCounter
        label="Radiation"
        value={overrides.radiation}
        onChange={(v) => setOverride("radiation", v)}
        onBump={(d) => bumpNumeric("radiation", NUMERIC_BUMP_BASE, d)}
      />
      <BadgeCounter
        label="Ring"
        value={overrides.ringLevel}
        onChange={(v) => setOverride("ringLevel", v)}
        onBump={(d) => bumpNumeric("ringLevel", NUMERIC_BUMP_BASE, d)}
      />
      <BadgeCounter
        label="Speed"
        value={overrides.speed}
        onChange={(v) => setOverride("speed", v)}
        onBump={(d) => bumpNumeric("speed", NUMERIC_BUMP_BASE, d)}
      />
      <BadgeCounter
        label="Hand"
        value={overrides.handCount}
        onChange={(v) => setOverride("handCount", v)}
        onBump={(d) => bumpNumeric("handCount", NUMERIC_BUMP_BASE, d)}
      />
      <BadgeCounter
        label="Life"
        value={overrides.life}
        onChange={(v) => setOverride("life", v)}
        onBump={(d) => bumpNumeric("life", LIFE_BUMP_BASE, d)}
      />
    </div>
  );
}

function ToggleButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "px-2 py-1.5 rounded text-xs font-medium border transition-colors",
        active
          ? "border-primary text-primary bg-primary/10"
          : "border-border/70 text-muted-foreground hover:text-foreground hover:bg-accent/50",
      )}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function BadgeCounter({
  label,
  value,
  onChange,
  onBump,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  onBump: (delta: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium w-16">{label}</span>
      <button
        className="px-1.5 py-0.5 rounded text-[10px] border border-border/70 hover:bg-accent/50"
        onClick={() => onBump(-1)}
      >
        −
      </button>
      <span className="text-xs font-mono tabular-nums w-8 text-center">{value ?? "—"}</span>
      <button
        className="px-1.5 py-0.5 rounded text-[10px] border border-border/70 hover:bg-accent/50"
        onClick={() => onBump(1)}
      >
        +
      </button>
      {value != null && (
        <button
          className="text-[10px] text-muted-foreground hover:text-destructive"
          onClick={() => onChange(null)}
        >
          clear
        </button>
      )}
    </div>
  );
}
