import { useId } from "react";
import { GAME_CARD_SIZES } from "@/components/game/game.constants";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import { Button } from "@/components/ui/button";
import { useLimitedBuildStore } from "@/components/limited/useLimitedBuildStore";
import type {
  BuildGroup,
  LimitedDisplayPreferences,
} from "@/components/limited/useLimitedBuildStore";

export function LimitedDisplaySettings({ sessionKey }: { sessionKey: string }) {
  const display = useLimitedBuildStore(
    (state) => state.sessions[sessionKey] ?? state.displayPreferences,
  );
  const cardHeightId = useId();
  const cardAspect = GAME_CARD_SIZES.hand.height / GAME_CARD_SIZES.hand.width;
  const cardHeight = display.cardSize * cardAspect;
  const update = (prefs: Partial<LimitedDisplayPreferences>) =>
    useLimitedBuildStore.getState().preferences(sessionKey, prefs);

  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold">Cards & layout</h3>
      <label htmlFor={cardHeightId} className="grid gap-1 text-sm">
        <span className="flex items-center justify-between gap-2">
          Card height
          <output htmlFor={cardHeightId} className="tabular-nums text-muted-foreground">
            {Math.round(cardHeight)} px
          </output>
        </span>
        <input
          id={cardHeightId}
          type="range"
          min={126}
          max={480}
          step={1}
          value={cardHeight}
          aria-valuetext={`${Math.round(cardHeight)} pixels`}
          onChange={(event) => update({ cardSize: Number(event.target.value) / cardAspect })}
          className="h-9 w-full cursor-pointer accent-primary pointer-coarse:h-11"
        />
      </label>
      <fieldset className="space-y-2">
        <legend className="text-sm">Group acquired cards</legend>
        <AppSelect
          aria-label="Group cards"
          value={display.group}
          onValueChange={(group) => update({ group: group as BuildGroup })}
          className="w-full"
        >
          <AppSelectOption value="none">No grouping</AppSelectOption>
          <AppSelectOption value="color">Color</AppSelectOption>
          <AppSelectOption value="cmc">Mana value</AppSelectOption>
          <AppSelectOption value="type">Type</AppSelectOption>
          <AppSelectOption value="rarity">Rarity</AppSelectOption>
        </AppSelect>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm">Acquired card view</legend>
        <div className="flex gap-2">
          <Button
            variant={display.mode === "gallery" ? "selected" : "outline"}
            size="sm"
            aria-pressed={display.mode === "gallery"}
            onClick={() => update({ mode: "gallery" })}
          >
            Gallery
          </Button>
          <Button
            variant={display.mode === "list" ? "selected" : "outline"}
            size="sm"
            aria-pressed={display.mode === "list"}
            onClick={() => update({ mode: "list" })}
          >
            List
          </Button>
        </div>
      </fieldset>
    </section>
  );
}
