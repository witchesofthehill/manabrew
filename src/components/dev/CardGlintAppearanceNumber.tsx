import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import type { CardInspectAppearance } from "@/lib/cardGlintInspectAppearance";

interface CardGlintAppearanceNumberProps {
  label: string;
  value: number;
  onChange: (next: number) => void;
  resetKey: CardInspectAppearance;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  disabled?: boolean;
}

export function CardGlintAppearanceNumber({
  label,
  value,
  onChange,
  resetKey,
  min = 0,
  max = 1,
  step = 0.01,
  integer = false,
  disabled = false,
}: CardGlintAppearanceNumberProps) {
  const id = useId();
  const [draft, setDraft] = useState({ source: resetKey, text: String(value) });
  const text = draft.source === resetKey ? draft.text : String(value);
  const restore = () => setDraft({ source: resetKey, text: String(value) });
  const commit = () => {
    const parsed = text.trim() === "" ? NaN : Number(text);
    if (!Number.isFinite(parsed)) {
      restore();
      return;
    }
    const bounded = Math.max(min, Math.min(max, integer ? Math.round(parsed) : parsed));
    setDraft({ source: resetKey, text: String(bounded) });
    if (bounded !== value) onChange(bounded);
  };

  return (
    <div className="grid min-w-0 gap-1.5">
      <label htmlFor={id} className="text-ui-label text-muted-foreground">
        {label}
      </label>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        {!integer && (
          <input
            type="range"
            aria-label={`${label} slider`}
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={disabled}
            className="h-9 min-w-24 flex-1 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 touch:min-h-11"
            onChange={(event) => {
              const next = event.currentTarget.valueAsNumber;
              if (Number.isFinite(next)) onChange(Math.max(min, Math.min(max, next)));
            }}
          />
        )}
        <Input
          id={id}
          type="number"
          inputMode={integer ? "numeric" : "decimal"}
          min={min}
          max={max}
          step={integer ? 1 : "any"}
          value={text}
          disabled={disabled}
          className="w-32 max-w-full shrink-0 tabular-nums"
          onChange={(event) => setDraft({ source: resetKey, text: event.currentTarget.value })}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              restore();
            }
          }}
        />
      </div>
    </div>
  );
}
