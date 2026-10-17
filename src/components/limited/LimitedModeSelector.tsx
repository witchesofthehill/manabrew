import { useId } from "react";
import { Check, Layers3, PackageOpen, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { LimitedSetupMode } from "@/components/limited/limitedSetup.types";

interface LimitedModeSelectorProps {
  mode: LimitedSetupMode;
  onChange: (mode: LimitedSetupMode) => void;
  disabled?: boolean;
  leadingControl?: ReactNode;
  actions?: ReactNode;
}

const MODES: { value: LimitedSetupMode; title: string; description: string; icon: LucideIcon }[] = [
  {
    value: "sealed",
    title: "Sealed",
    description: "Open boosters and build a deck. Your opponent opens a separate pool.",
    icon: PackageOpen,
  },
  {
    value: "draft",
    title: "Draft",
    description: "Pick cards and pass packs with AI players. Each player opens three boosters.",
    icon: Users,
  },
  {
    value: "winston",
    title: "Winston",
    description: "Draft three shared piles against one AI. Basic lands are excluded.",
    icon: Layers3,
  },
];

export function LimitedModeSelector({
  mode,
  onChange,
  disabled = false,
  leadingControl,
  actions,
}: LimitedModeSelectorProps) {
  const groupId = useId();

  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="sr-only">Choose a format</legend>
      <div className="mb-2 flex min-h-9 items-center justify-between gap-3">
        {leadingControl ?? <h2 className="font-serif text-lg">Choose a format</h2>}
        {actions}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {MODES.map(({ value, title, icon: Icon }) => (
          <label
            key={value}
            className={cn(
              "relative flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border px-2 py-2 transition-colors focus-within:ring-2 focus-within:ring-ring motion-reduce:transition-none",
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
              aria-describedby={mode === value ? `${groupId}-description` : undefined}
              checked={mode === value}
              onChange={() => onChange(value)}
              className="peer sr-only"
            />
            {mode === value ? (
              <Check aria-hidden="true" className="h-4 w-4 shrink-0" />
            ) : (
              <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
            )}
            <span className="font-serif text-base text-foreground">{title}</span>
          </label>
        ))}
      </div>
      <p
        id={`${groupId}-description`}
        className="mt-2 text-sm leading-relaxed text-muted-foreground"
      >
        {MODES.find(({ value }) => value === mode)?.description}
      </p>
    </fieldset>
  );
}
