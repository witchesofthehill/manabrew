import { useId } from "react";
import { Input } from "@/components/ui/input";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import { LimitedPickClockSetting } from "@/components/limited/LimitedPickClockSetting";
import type { LimitedSetupMode } from "@/components/limited/limitedSetup.types";

interface LimitedSetupOptionsProps {
  mode: LimitedSetupMode;
  numBoosters: number;
  onNumBoostersChange: (n: number) => void;
  podSize: number;
  onPodSizeChange: (n: number) => void;
  winstonPacks: number;
  onWinstonPacksChange: (n: number) => void;
  seed: string;
  onSeedChange: (s: string) => void;
  picksPerPass: number;
  onPicksPerPassChange: (n: number) => void;
  pickSeconds?: number;
  onPickSecondsChange: (seconds: number | undefined) => void;
  variants: readonly string[];
  selectedVariant: string;
  onVariantChange: (variant: string) => void;
  disabled?: boolean;
}
interface NumberFieldProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}
function NumberField({ id, label, value, min, max, onChange }: NumberFieldProps) {
  return (
    <label
      htmlFor={id}
      className="flex min-w-0 flex-col gap-2 text-ui-label font-medium text-foreground"
    >
      {label}
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(event) => {
          const next = event.currentTarget.valueAsNumber;
          onChange(Number.isFinite(next) ? Math.max(min, Math.min(max, Math.trunc(next))) : min);
        }}
        className="w-full"
      />
    </label>
  );
}
export function LimitedSetupOptions(props: LimitedSetupOptionsProps) {
  const id = useId();
  const variants = [...new Set(props.variants.filter((variant) => variant.trim()))];
  return (
    <fieldset disabled={props.disabled} className="min-w-0 space-y-4">
      <legend className="mb-3 font-serif text-lg font-semibold text-foreground">Options</legend>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3">
        {props.mode === "sealed" && (
          <NumberField
            id={`${id}-sealed-packs`}
            label="Boosters"
            value={props.numBoosters}
            min={3}
            max={12}
            onChange={props.onNumBoostersChange}
          />
        )}
        {props.mode === "draft" && (
          <NumberField
            id={`${id}-pod-size`}
            label="Players"
            value={props.podSize}
            min={2}
            max={8}
            onChange={props.onPodSizeChange}
          />
        )}
        {props.mode === "winston" && (
          <NumberField
            id={`${id}-winston-packs`}
            label="Boosters per player"
            value={props.winstonPacks}
            min={2}
            max={12}
            onChange={props.onWinstonPacksChange}
          />
        )}
        {variants.length > 0 && (
          <div className="space-y-2">
            <span id={`${id}-variant-label`} className="block text-ui-label font-medium">
              Booster variant
            </span>
            <AppSelect
              aria-labelledby={`${id}-variant-label`}
              value={props.selectedVariant}
              onValueChange={props.onVariantChange}
              disabled={props.disabled}
              className="w-full"
            >
              <AppSelectOption value="">Default</AppSelectOption>
              {variants.map((variant) => (
                <AppSelectOption key={variant} value={variant}>
                  {variant}
                </AppSelectOption>
              ))}
            </AppSelect>
          </div>
        )}
      </div>
      {props.mode === "draft" && (
        <LimitedPickClockSetting
          pickSeconds={props.pickSeconds}
          onPickSecondsChange={props.onPickSecondsChange}
          disabled={props.disabled}
        />
      )}
      <details className="border-t border-border/60 pt-3">
        <summary className="min-h-8 w-fit cursor-pointer rounded-sm text-ui-label text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch:min-h-11">
          Advanced
        </summary>
        <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3">
          {props.mode === "draft" && (
            <NumberField
              id={`${id}-picks`}
              label="Picks per pass"
              value={props.picksPerPass}
              min={1}
              max={4}
              onChange={props.onPicksPerPassChange}
            />
          )}
          <label
            htmlFor={`${id}-seed`}
            className="flex min-w-0 flex-col gap-2 text-ui-label font-medium text-foreground"
          >
            Seed (optional)
            <Input
              id={`${id}-seed`}
              type="text"
              inputMode="numeric"
              value={props.seed}
              onChange={(event) => props.onSeedChange(event.currentTarget.value)}
              placeholder="Random"
              className="font-mono"
            />
          </label>
        </div>
      </details>
    </fieldset>
  );
}
