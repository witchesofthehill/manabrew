import { useId } from "react";
import { Input } from "@/components/ui/input";
import { MIN_PICK_SECONDS, MAX_PICK_SECONDS } from "@/game/limitedDraftClock";

interface LimitedPickClockSettingProps {
  pickSeconds?: number;
  onPickSecondsChange: (seconds: number | undefined) => void;
  disabled?: boolean;
  supported?: boolean;
}

export function LimitedPickClockSetting({
  pickSeconds,
  onPickSecondsChange,
  disabled = false,
  supported = true,
}: LimitedPickClockSettingProps) {
  const id = useId();
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={pickSeconds !== undefined}
          disabled={disabled || !supported}
          onChange={(event) => onPickSecondsChange(event.currentTarget.checked ? 60 : undefined)}
          className="h-4 w-4 accent-primary"
        />
        Pick clock
      </label>
      {pickSeconds !== undefined && (
        <label
          htmlFor={id}
          className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
        >
          <Input
            id={id}
            type="number"
            min={MIN_PICK_SECONDS}
            max={MAX_PICK_SECONDS}
            step={1}
            value={pickSeconds}
            disabled={disabled || !supported}
            onChange={(event) => {
              const next = event.currentTarget.valueAsNumber;
              if (Number.isFinite(next))
                onPickSecondsChange(
                  Math.max(MIN_PICK_SECONDS, Math.min(MAX_PICK_SECONDS, Math.trunc(next))),
                );
            }}
            className="w-24"
          />
          seconds per pick
        </label>
      )}
      <p className="text-xs text-muted-foreground">
        {supported
          ? "Untimed by default. When time runs out, your fallback or the AI's choice goes to Pool."
          : "Update the relay to use pick clocks."}
      </p>
    </div>
  );
}
