import { cn } from "@/lib/utils";
import { useGameDevStore } from "@/stores/useGameDevStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

import {
  DEV_CONTROL_ACTIVE,
  DEV_CONTROL_BUTTON,
  DEV_CONTROL_INACTIVE,
  DEV_SECTION,
  DEV_SECTION_HEADING,
} from "./devPanel.styles";
import { DEV_VIEWPORT_OPTIONS } from "./devViewportPresets";

const CARD_SIZE_PRESETS = [0.75, 1, 1.25, 1.5] as const;

export function DevSizingControls() {
  const cardSize = usePreferencesStore((s) => s.cardSizeMultiplier);
  const setCardSize = usePreferencesStore((s) => s.setCardSizeMultiplier);
  const viewport = useGameDevStore((s) => s.debugViewportPreset);
  const setViewport = useGameDevStore((s) => s.setDebugViewportPreset);

  return (
    <section className={DEV_SECTION}>
      <p className={DEV_SECTION_HEADING}>Size and viewport</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Reflow the real Pixi board at fixed dimensions without opening browser tools.
      </p>

      <p className="mb-2 mt-4 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Card size
      </p>
      <div className="grid grid-cols-4 gap-1.5">
        {CARD_SIZE_PRESETS.map((size) => (
          <button
            key={size}
            type="button"
            className={cn(
              DEV_CONTROL_BUTTON,
              cardSize === size ? DEV_CONTROL_ACTIVE : DEV_CONTROL_INACTIVE,
            )}
            onClick={() => setCardSize(size)}
          >
            {Math.round(size * 100)}%
          </button>
        ))}
      </div>

      <p className="mb-2 mt-4 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Board viewport
      </p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
        {DEV_VIEWPORT_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={cn(
              DEV_CONTROL_BUTTON,
              "min-w-0",
              viewport === option.value ? DEV_CONTROL_ACTIVE : DEV_CONTROL_INACTIVE,
            )}
            onClick={() => setViewport(option.value)}
            title={
              option.width == null ? "Use the current window" : `${option.width}×${option.height}`
            }
          >
            <span className="block truncate">{option.label}</span>
            {option.width != null ? (
              <span className="mt-0.5 block font-mono text-[9px] font-normal opacity-70">
                {option.width}×{option.height}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </section>
  );
}
