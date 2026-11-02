import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { CARD_CUSTOMIZER_RANGE } from "@/components/editor/cardCustomizerControls.styles";

export function CardCustomizerNumber({
  label,
  value,
  min,
  max,
  step = 0.05,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState({ value, text: value });
  const text = draft.value === value ? draft.text : value;
  const restore = () => setDraft({ value, text: value });
  const commit = () => {
    const parsed = text.trim() === "" ? NaN : Number(text);
    if (!Number.isFinite(parsed)) {
      restore();
      return;
    }
    const bounded = String(Math.max(min, Math.min(max, parsed)));
    setDraft({ value, text: bounded });
    if (bounded !== value) onChange(bounded);
  };
  return (
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={id} className="touch:min-h-11 block text-ui-label text-muted-foreground">
        {label}
      </label>
      <div className="flex min-w-0 items-center gap-2">
        <input
          type="range"
          aria-label={`${label} slider`}
          aria-valuetext={value}
          min={min}
          max={max}
          step={step}
          value={Number(value)}
          disabled={disabled}
          className={CARD_CUSTOMIZER_RANGE}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step="any"
          value={text}
          disabled={disabled}
          className="touch:min-h-11 w-16 shrink-0 px-2 tabular-nums"
          onChange={(event) => setDraft({ value, text: event.currentTarget.value })}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              if (event.key === "Enter") commit();
              else restore();
            }
          }}
        />
      </div>
    </div>
  );
}
