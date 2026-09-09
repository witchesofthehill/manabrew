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
import { matchesDevPanelSearch, useDevPanelSearch } from "./devPanelSearchContext";

export function BattlefieldStyleDevControls() {
  const style = usePreferencesStore((s) => s.battlefieldCardStyle);
  const setStyle = usePreferencesStore((s) => s.setBattlefieldCardStyle);
  const query = useDevPanelSearch();
  const showAll = matchesDevPanelSearch(
    query,
    "Battlefield card style",
    "Switch every battlefield card",
  );
  const visibleOptions = showAll
    ? BATTLEFIELD_CARD_STYLE_OPTIONS
    : BATTLEFIELD_CARD_STYLE_OPTIONS.filter((option) =>
        matchesDevPanelSearch(query, option.label, option.value),
      );

  if (visibleOptions.length === 0) return null;

  return (
    <section className={DEV_SECTION}>
      <p className={DEV_SECTION_HEADING}>Battlefield card style</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Switch every battlefield card live. This also updates the saved app preference.
      </p>
      <div className="mt-3 grid grid-cols-3 gap-1.5">
        {visibleOptions.map((option) => (
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
