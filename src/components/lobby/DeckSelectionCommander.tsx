import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import { Label } from "@/components/ui/label";
import { PartnerBadge } from "@/components/deck/PartnerBadge";
import type { DeckSelectionModel } from "./useDeckSelection";

export function DeckSelectionCommander({ model }: { model: DeckSelectionModel }) {
  const {
    needsCommander,
    selectedDeckEntry,
    selectedPartnerLabel,
    selectedDeckCommanders,
    legendaryCreatures,
    selectedCommander,
    chooseCommander,
    disabled,
  } = model;
  if (!needsCommander || !selectedDeckEntry) return null;
  return (
    <div>
      <Label className="text-ui-label font-semibold">Commander</Label>
      <div className="mt-2 space-y-1.5">
        {selectedPartnerLabel ? (
          <div className="flex flex-wrap items-center gap-1.5 rounded border border-border bg-background px-2 py-1.5 text-ui-meta">
            <span className="truncate">{selectedDeckCommanders[0].identity.name}</span>
            <span className="text-muted-foreground">+</span>
            <span className="truncate">{selectedDeckCommanders[1].identity.name}</span>
            <PartnerBadge label={selectedPartnerLabel} />
          </div>
        ) : (
          <>
            {legendaryCreatures.length === 0 && (
              <p className="text-ui-meta text-muted-foreground italic">
                No legendary creatures in this deck. Enter a commander name.
              </p>
            )}
            {legendaryCreatures.length > 0 ? (
              <AppSelect
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-ui-label "
                value={selectedCommander}
                onValueChange={chooseCommander}
                disabled={disabled}
                aria-label="Commander"
              >
                <AppSelectOption value="">— Choose —</AppSelectOption>
                {legendaryCreatures.map((name) => (
                  <AppSelectOption key={name} value={name}>
                    {name}
                  </AppSelectOption>
                ))}
              </AppSelect>
            ) : (
              <input
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-ui-input touch:min-h-11 touch:min-w-11"
                placeholder={`Card name`}
                value={selectedCommander}
                onChange={(event) => chooseCommander(event.target.value)}
                disabled={disabled}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
