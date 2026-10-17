import type { EditionInfo } from "@/api/limitedEdition";
import { SET_TYPE_LABELS } from "@/components/limited/setFilters";
import type { ScryfallSet } from "@/types/scryfall";

interface LimitedBoosterDetailsProps {
  set: ScryfallSet;
  info: EditionInfo | null;
  loading: boolean;
}

export function LimitedBoosterDetails({ set, info, loading }: LimitedBoosterDetailsProps) {
  const setType = SET_TYPE_LABELS.find(({ key }) => key === set.set_type)?.label ?? set.set_type;
  const recipe = loading ? null : info;
  return (
    <details className="group border-t border-border/60 pt-3">
      <summary className="w-fit cursor-pointer rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Booster details
      </summary>
      <div className="mt-3 space-y-4 text-xs">
        <div>
          <h4 className="mb-2 font-medium text-foreground">Default booster recipe</h4>
          {loading ? (
            <p className="text-muted-foreground">Loading booster recipe...</p>
          ) : recipe ? (
            <div className="flex flex-wrap gap-1.5">
              {recipe.slots.map((slot, index) => (
                <span
                  key={`${slot.label}-${index}`}
                  className="max-w-full break-words rounded bg-muted/60 px-2 py-1 font-mono text-foreground/90"
                >
                  {slot.count}× {slot.label}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">
              No Forge booster recipe for this set. Packs use the generic recipe of 10 commons, 3
              uncommons, 1 rare or mythic, and 1 land.
            </p>
          )}
        </div>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Set code</dt>
            <dd className="mt-0.5 font-mono text-foreground">{set.code.toUpperCase()}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Type</dt>
            <dd className="mt-0.5 text-foreground">
              {setType}
              {recipe?.editionType && ` · Forge ${recipe.editionType}`}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Released</dt>
            <dd className="mt-0.5 text-foreground">
              {recipe?.date ?? set.released_at ?? "Unknown"}
            </dd>
          </div>
          {recipe?.alias && (
            <div>
              <dt className="text-muted-foreground">Alias</dt>
              <dd className="mt-0.5 break-words font-mono text-foreground">{recipe.alias}</dd>
            </div>
          )}
          {recipe?.prerelease && (
            <div>
              <dt className="text-muted-foreground">Prerelease</dt>
              <dd className="mt-0.5 break-words text-foreground">{recipe.prerelease}</dd>
            </div>
          )}
          {recipe && (
            <>
              <div>
                <dt className="text-muted-foreground">Foils</dt>
                <dd className="mt-0.5 text-foreground">
                  {recipe.foilType === "NotSupported"
                    ? "No foils in this recipe"
                    : `${Math.round(recipe.foilChance * 100)}% chance · ${recipe.foilType === "OldStyle" ? "Old-style" : recipe.foilType}`}
                </dd>
              </div>
              {recipe.boosterCovers !== undefined && (
                <div>
                  <dt className="text-muted-foreground">Booster covers</dt>
                  <dd className="mt-0.5 text-foreground">{recipe.boosterCovers}</dd>
                </div>
              )}
              <div>
                <dt className="text-muted-foreground">Slot replacements</dt>
                <dd className="mt-0.5 text-foreground">
                  {recipe.hasReplacementHooks ? "Set-specific replacements active" : "None"}
                </dd>
              </div>
            </>
          )}
        </dl>
      </div>
    </details>
  );
}
