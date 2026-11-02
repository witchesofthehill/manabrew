import { CARD_CUSTOMIZER_RANGE } from "@/components/editor/cardCustomizerControls.styles";

export function CardCustomizerSurfaceWear({
  wear,
  disabled,
  onWearChange,
}: {
  wear: string;
  disabled: boolean;
  onWearChange: (value: string) => void;
}) {
  return (
    <input
      type="range"
      aria-label="Wear slider"
      aria-valuetext={`${Math.round(Number(wear) * 1000) / 10}%`}
      min={0}
      max={1}
      step={0.001}
      value={Number(wear)}
      disabled={disabled}
      className={CARD_CUSTOMIZER_RANGE}
      onChange={(event) => onWearChange(event.currentTarget.value)}
    />
  );
}
