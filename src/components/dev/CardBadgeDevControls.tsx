import { cn } from "@/lib/utils";
import {
  hasActiveCardOverride,
  useGameDevStore,
  type DevCardOverrides,
} from "@/stores/useGameDevStore";

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
  const triggerEtbGlow = useGameDevStore((s) => s.triggerEtbGlow);

  const dirty = hasActiveCardOverride(overrides);

  const toggleBool = (key: BoolKey) => setOverride(key, !overrides[key]);
  const bumpNum = (key: NumKey, delta: number) => {
    const curr = overrides[key] ?? 0;
    const next = Math.max(0, curr + delta);
    setOverride(key, next);
  };

  return (
    <div className="flex flex-col gap-2 mt-2 rounded-md border border-border/70 p-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Card badges (battlefield)
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
        {STATUS_ROWS.map((row) => (
          <ToggleButton
            key={row.key}
            label={row.label}
            active={overrides[row.key]}
            onClick={() => toggleBool(row.key)}
          />
        ))}
      </div>

      {COUNTER_ROWS.map((row) => (
        <BadgeCounter
          key={row.key}
          label={row.label}
          value={overrides[row.key]}
          onChange={(v) => setOverride(row.key, v)}
          onBump={(d) => bumpNum(row.key, d)}
        />
      ))}

      <div className="flex items-center gap-2 pt-1 border-t border-border/50 mt-1">
        <button
          type="button"
          className="px-2 py-1.5 rounded text-xs font-medium border border-border/70 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          onClick={triggerEtbGlow}
          title="Re-fires the just-entered glow on every battlefield sprite"
        >
          Trigger ETB glow
        </button>
      </div>
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
