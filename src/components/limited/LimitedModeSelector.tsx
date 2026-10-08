import { useId } from "react";
import { Check, Layers3, PackageOpen, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LimitedSetupMode } from "@/components/limited/limitedSetup.types";

interface LimitedModeSelectorProps {
  mode: LimitedSetupMode;
  onChange: (mode: LimitedSetupMode) => void;
  disabled?: boolean;
}

const MODES: { value: LimitedSetupMode; title: string; description: string; icon: LucideIcon }[] = [
  { value: "sealed", title: "Sealed", description: "Open packs, build a deck", icon: PackageOpen },
  { value: "draft", title: "Booster Draft", description: "Pick cards, pass packs", icon: Users },
  { value: "winston", title: "Winston", description: "Draft from shared piles", icon: Layers3 },
];

export function LimitedModeSelector({
  mode,
  onChange,
  disabled = false,
}: LimitedModeSelectorProps) {
  const groupId = useId();

  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-3 font-serif text-xl text-foreground">Choose a format</legend>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {MODES.map(({ value, title, description, icon: Icon }) => (
          <label
            key={value}
            className={cn(
              "relative flex min-h-32 cursor-pointer flex-col gap-2 rounded-lg border p-3 transition-colors focus-within:ring-2 focus-within:ring-ring sm:p-4",
              mode === value
                ? "border-selection bg-selection/10 text-foreground"
                : "border-border/80 bg-card/40 text-muted-foreground hover:border-foreground/30 hover:bg-muted/50",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            <input
              type="radio"
              name={groupId}
              value={value}
              aria-label={title}
              aria-describedby={`${groupId}-${value}-description`}
              checked={mode === value}
              onChange={() => onChange(value)}
              className="peer sr-only"
            />
            <div aria-hidden="true" className="flex items-center justify-between">
              <Icon className="h-5 w-5" />
              <span
                className={cn(
                  "flex h-4 w-4 items-center justify-center rounded-full border",
                  mode === value ? "border-selection text-selection" : "border-border",
                )}
              >
                {mode === value && <Check className="h-3 w-3" />}
              </span>
            </div>
            <span className="font-serif text-base leading-tight text-foreground sm:text-lg">
              {title}
            </span>
            <span
              id={`${groupId}-${value}-description`}
              className="text-xs leading-relaxed text-muted-foreground"
            >
              {description}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
