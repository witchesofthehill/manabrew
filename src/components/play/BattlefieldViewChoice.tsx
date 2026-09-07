import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { cn } from "@/lib/utils";

export function BattlefieldViewChoice() {
  const view = usePreferencesStore((state) => state.battlefieldRenderer);
  const setView = usePreferencesStore((state) => state.setBattlefieldRenderer);
  return (
    <fieldset className="rounded-xl border border-border bg-card/80 p-3">
      <legend className="px-1 text-sm font-medium text-foreground">Battlefield view</legend>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Your view for AI and multiplayer matches. Remembered for next time.
        </p>
        <div className="flex gap-2">
          {(
            [
              ["classic", "Classic"],
              ["3d", "3D"],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm",
                view === value
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground",
              )}
            >
              <input
                type="radio"
                name="battlefield-view"
                value={value}
                checked={view === value}
                onChange={() => setView(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </div>
    </fieldset>
  );
}
