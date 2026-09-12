import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatThemeColor, parseThemeColor } from "@/themes/gameTheme";

export function ThemeColorControl({
  token,
  label,
  description,
  value,
  overridden,
  onChange,
  onReset,
  onValidityChange,
}: {
  token: string;
  label: string;
  description?: string;
  value: string;
  overridden: boolean;
  onChange: (value: string) => void;
  onReset: () => void;
  onValidityChange: (token: string, invalid: boolean) => void;
}) {
  const id = useId();
  const [raw, setRaw] = useState(value);
  const [sourceValue, setSourceValue] = useState(value);
  if (sourceValue !== value) {
    setSourceValue(value);
    setRaw(value);
  }
  const parsed = parseThemeColor(value);
  const invalid = parseThemeColor(raw) === null;
  const invalidResolved = parsed === null;
  useEffect(() => {
    onValidityChange(token, invalid || invalidResolved);
    return () => onValidityChange(token, false);
  }, [token, invalid, invalidResolved, onValidityChange]);

  function commit() {
    const color = parseThemeColor(raw);
    if (color) {
      const formatted = formatThemeColor(color.hex, color.alpha);
      setRaw(formatted);
      onChange(formatted);
    }
  }

  return (
    <div className="space-y-1.5 border-t border-border py-3 first:border-t-0">
      <div className="flex items-center justify-between gap-1">
        <Label htmlFor={`${id}-raw`} className="text-xs leading-snug">
          {label}
        </Label>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-1.5 text-[10px]"
          disabled={!overridden && !invalid}
          title="Remove this override and inherit the base preset color"
          onClick={() => {
            setRaw(value);
            onReset();
          }}
        >
          Reset
        </Button>
      </div>
      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <code className="min-w-0 break-all">{token}</code>
        <span className="shrink-0">{overridden ? "Overridden" : "Inherited"}</span>
      </div>
      {description && (
        <p className="text-[11px] leading-snug text-muted-foreground">{description}</p>
      )}
      <div className="flex items-center gap-2">
        {parsed && (
          <input
            id={`${id}-picker`}
            type="color"
            aria-label={`${label} color picker`}
            title={`${label} hue. Alpha is controlled separately.`}
            value={parsed.hex}
            className="h-8 w-8 shrink-0 cursor-pointer rounded border border-input bg-background p-0.5"
            onChange={(event) => onChange(formatThemeColor(event.target.value, parsed.alpha))}
          />
        )}
        <Input
          id={`${id}-raw`}
          value={raw}
          className="h-8 min-w-0 font-mono text-[11px] md:text-[11px]"
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : undefined}
          onChange={(event) => setRaw(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "Escape") setRaw(value);
          }}
        />
      </div>
      {invalid && (
        <p id={`${id}-error`} role="alert" className="text-[11px] text-destructive">
          Enter a valid hex or rgba color. This value has not been applied.
        </p>
      )}
      {!parsed && (
        <p role="alert" className="text-[11px] text-destructive">
          The resolved token is not a supported color.
        </p>
      )}
      {parsed && (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <label htmlFor={`${id}-alpha`}>Alpha</label>
          <input
            id={`${id}-alpha`}
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={parsed.alpha}
            className="min-w-0 flex-1 accent-primary"
            onChange={(event) => onChange(formatThemeColor(parsed.hex, Number(event.target.value)))}
          />
          <output htmlFor={`${id}-alpha`} className="w-8 text-right tabular-nums">
            {Math.round(parsed.alpha * 100)}%
          </output>
        </div>
      )}
    </div>
  );
}
