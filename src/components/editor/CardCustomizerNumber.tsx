import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { CARD_CUSTOMIZER_RANGE } from "@/components/editor/cardCustomizerControls.styles";

export function CardCustomizerNumber({
  label,
  value,
  selectionKey,
  min,
  max,
  step = 0.05,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string;
  selectionKey: string;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState({ value, selectionKey, text: value === "mixed" ? "" : value });
  const current = value === "mixed" ? "" : value;
  const text = draft.value === value && draft.selectionKey === selectionKey ? draft.text : current;
  const restore = () => setDraft({ value, selectionKey, text: current });
  const commit = () => {
    const parsed = text.trim() === "" ? NaN : Number(text);
    if (!Number.isFinite(parsed)) {
      restore();
      return;
    }
    const bounded = String(Math.max(min, Math.min(max, parsed)));
    setDraft({ value, selectionKey, text: bounded });
    if (bounded !== value) onChange(bounded);
  };
  return (
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={id} className="block text-xs text-muted-foreground">
        {label}
      </label>
      <div className="flex min-w-0 items-center gap-2">
        <input
          type="range"
          aria-label={`${label} slider`}
          aria-valuetext={value === "mixed" ? "Mixed" : value}
          min={min}
          max={max}
          step={step}
          value={value === "mixed" ? (min + max) / 2 : Number(value)}
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
          placeholder={value === "mixed" ? "Mixed" : undefined}
          disabled={disabled}
          className="w-16 shrink-0 px-2 tabular-nums"
          onChange={(event) => setDraft({ value, selectionKey, text: event.currentTarget.value })}
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
