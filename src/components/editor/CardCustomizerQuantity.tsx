import { useId, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CardCustomizerQuantity({
  value,
  max,
  disabled,
  onChange,
}: {
  value: number;
  max: number;
  disabled: boolean;
  onChange: (quantity: number) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const parsed = draft === null || draft.trim() === "" ? value : Number(draft);
  const count = Number.isFinite(parsed) ? Math.trunc(parsed) : value;
  const apply = (delta = 0) => {
    const next = Math.max(0, Math.min(max, count + delta));
    setDraft(null);
    if (next !== value) onChange(next);
  };

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        Select number of copies
      </label>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          aria-label="Select one fewer copy"
          disabled={disabled || count <= 0}
          onClick={() => apply(-1)}
        >
          <Minus className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          step={1}
          value={draft ?? String(value)}
          disabled={disabled}
          aria-describedby={`${id}-hint`}
          className="w-20 text-center font-mono"
          onFocus={(event) => {
            setDraft(String(value));
            event.currentTarget.select();
          }}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={() => apply()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          aria-label="Select one more copy"
          disabled={disabled || count >= max}
          onClick={() => apply(1)}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </Button>
        <span className="text-sm text-muted-foreground">of {max}</span>
      </div>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        Selects the inspected copy first, then deck order. Does not change appearances.
      </p>
    </div>
  );
}
