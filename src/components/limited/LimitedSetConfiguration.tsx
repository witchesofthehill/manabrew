import { Button } from "@/components/ui/button";
import { SetSymbol } from "@/components/limited/SetSymbol";
import { LimitedBoosterDetails } from "@/components/limited/LimitedBoosterDetails";
import { SetPicker } from "@/components/limited/SetPicker";
import type { EditionInfo } from "@/api/limitedEdition";
import type { ScryfallSet } from "@/types/scryfall";

interface LimitedSetConfigurationProps {
  sets: ScryfallSet[];
  selectedCode: string;
  prefetching: string | null;
  onSelect: (code: string) => void;
  info: EditionInfo | null;
  loading: boolean;
  selectedVariant: string;
  onViewCards: () => void;
  disabled?: boolean;
}

export function LimitedSetConfiguration({
  sets,
  selectedCode,
  prefetching,
  onSelect,
  info,
  loading,
  selectedVariant,
  onViewCards,
  disabled = false,
}: LimitedSetConfigurationProps) {
  const selectedSet = sets.find((set) => set.code === selectedCode);
  const boosterCount =
    !loading && info && info.slots.length > 0 && !selectedVariant
      ? info.slots.reduce((total, slot) => total + slot.count, 0)
      : null;
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-4">
      <SetPicker
        sets={sets}
        selectedCode={selectedCode}
        prefetching={prefetching}
        onSelect={onSelect}
        renderSelected={(set, onChange) => (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 py-2">
            <div className="flex min-w-0 basis-full items-center gap-4 sm:flex-1 sm:basis-auto">
              <SetSymbol
                setCode={set.code}
                className="h-12 w-12 shrink-0 text-foreground/80 sm:h-16 sm:w-16"
              />
              <div className="min-w-0">
                <h3 className="break-words font-serif text-2xl font-semibold leading-tight text-foreground sm:text-3xl">
                  {set.name}
                </h3>
                <p className="mt-1 text-ui-meta text-muted-foreground">
                  {set.card_count} cards
                  {boosterCount !== null && ` · ${boosterCount} cards per booster`}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onChange}>
                Change set
              </Button>
              <Button type="button" variant="link" size="sm" onClick={onViewCards}>
                View cards
              </Button>
            </div>
          </div>
        )}
        resultsClassName="max-h-80 overflow-y-auto overscroll-contain pr-1 lg:max-h-none lg:overflow-visible"
      />
      {selectedSet && (
        <>
          <div role="status" aria-live="polite" className="text-ui-meta text-muted-foreground">
            {loading && <p>Loading booster details…</p>}
            {prefetching === selectedCode && <p>Preparing card images…</p>}
          </div>
          <LimitedBoosterDetails
            key={selectedCode}
            set={selectedSet}
            info={info}
            loading={loading}
          />
        </>
      )}
    </fieldset>
  );
}
