import { BATTLEFIELD_CARD_STYLE_OPTIONS } from "@/components/game/battlefieldCardStyles";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

import {
  DEV_CONTROL_ACTIVE,
  DEV_CONTROL_BUTTON,
  DEV_CONTROL_INACTIVE,
  DEV_SECTION,
  DEV_SECTION_HEADING,
} from "./devPanel.styles";

export function BattlefieldStyleDevControls() {
  const style = usePreferencesStore((s) => s.battlefieldCardStyle);
  const setStyle = usePreferencesStore((s) => s.setBattlefieldCardStyle);

  return (
    <section className={DEV_SECTION}>
      <p className={DEV_SECTION_HEADING}>Battlefield card style</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Switch every battlefield card live. This also updates the saved app preference.
      </p>
      <div className="mt-3 grid grid-cols-3 gap-1.5">
        {BATTLEFIELD_CARD_STYLE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={cn(
              DEV_CONTROL_BUTTON,
              style === option.value ? DEV_CONTROL_ACTIVE : DEV_CONTROL_INACTIVE,
            )}
            onClick={() => setStyle(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </section>
  );
}
