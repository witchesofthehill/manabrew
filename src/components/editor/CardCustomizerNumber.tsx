import { useId } from "react";
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
  return (
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={id} className="touch:min-h-11 block text-ui-label font-medium">
        {label}
      </label>
      <input
        id={id}
        type="range"
        aria-valuetext={value}
        min={min}
        max={max}
        step={step}
        value={Number(value)}
        disabled={disabled}
        className={CARD_CUSTOMIZER_RANGE}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  );
}
