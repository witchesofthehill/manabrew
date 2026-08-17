import { Target } from "lucide-react";

import { Input } from "@/components/ui/input";
import { deckOwnershipByName } from "@/lib/collection";
import { isLand } from "@/lib/mana";
import { useCollectionStore } from "@/stores/useCollectionStore";
import { useDeckStore } from "@/stores/useDeckStore";
import type { DeckEditorGoals } from "@/types/manabrew";
import { cn } from "@/lib/utils";
import { EDITOR_PANEL_CLASS, EDITOR_SUBTLE_BLOCK_CLASS } from "./deckEditor.styles";
import { useDeckEditTransaction } from "./useDeckEditTransaction";

export function DeckGoalsPanel() {
  const deck = useDeckStore((state) => state.currentDeck);
  const setEditorMetadata = useDeckStore((state) => state.setEditorMetadata);
  const quantities = useCollectionStore((state) => state.quantities);
  const goals = deck.editor?.goals ?? {};
  const goalEdit = useDeckEditTransaction("Update deck goals");
  const lands = deck.cards.filter((card) => isLand(card.types)).length;
  const nonlands = deck.cards.filter((card) => !isLand(card.types));
  const averageManaValue = nonlands.length
    ? nonlands.reduce((sum, card) => sum + (card.cmc ?? 0), 0) / nonlands.length
    : 0;
  const missing = [
    ...deckOwnershipByName(quantities, [
      ...deck.cards,
      ...(deck.commanders ?? []),
      ...deck.sideboard,
    ]).values(),
  ].reduce((sum, ownership) => sum + ownership.shortage, 0);

  function update(key: keyof DeckEditorGoals, value: string) {
    const number = value === "" ? undefined : Math.max(0, Number(value));
    setEditorMetadata({
      ...deck.editor,
      version: 1,
      tags: deck.editor?.tags ?? [],
      layouts: deck.editor?.layouts ?? [],
      goals: { ...goals, [key]: number },
    });
  }

  function updateTagTarget(tag: string, value: string) {
    const tagTargets = { ...goals.tagTargets };
    if (value === "") delete tagTargets[tag];
    else tagTargets[tag] = Math.max(0, Number(value));
    setEditorMetadata({
      ...deck.editor,
      version: 1,
      tags: deck.editor?.tags ?? [],
      layouts: deck.editor?.layouts ?? [],
      goals: { ...goals, tagTargets },
    });
  }

  const rows = [
    {
      key: "minLands" as const,
      label: "Minimum lands",
      current: lands,
      met: lands >= (goals.minLands ?? 0),
    },
    {
      key: "maxLands" as const,
      label: "Maximum lands",
      current: lands,
      met: lands <= (goals.maxLands ?? Infinity),
    },
    {
      key: "maxMissingCards" as const,
      label: "Maximum missing cards",
      current: missing,
      met: missing <= (goals.maxMissingCards ?? Infinity),
    },
    {
      key: "maxAverageManaValue" as const,
      label: "Maximum average mana value",
      current: averageManaValue.toFixed(2),
      met: averageManaValue <= (goals.maxAverageManaValue ?? Infinity),
      step: "0.1",
    },
  ];

  return (
    <section className={EDITOR_PANEL_CLASS}>
      <div className="mb-3 flex items-center gap-2">
        <Target className="h-4 w-4 text-primary" />
        <div>
          <h3 className="text-sm font-semibold">Deck goals</h3>
          <p className="text-[10px] text-muted-foreground">
            Optional targets, separate from legality.
          </p>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map((row) => (
          <label key={row.key} className={cn("flex items-center gap-2", EDITOR_SUBTLE_BLOCK_CLASS)}>
            <span className="min-w-0 flex-1 text-xs">{row.label}</span>
            <span
              className={cn("text-xs font-mono", row.met ? "text-legality-legal" : "text-warning")}
            >
              {row.current}
            </span>
            <Input
              className="h-7 w-20 text-right text-xs"
              type="number"
              min="0"
              step={row.step}
              value={goals[row.key] ?? ""}
              onFocus={goalEdit.begin}
              onChange={(event) => update(row.key, event.target.value)}
              onBlur={goalEdit.commit}
              placeholder="Any"
            />
          </label>
        ))}
      </div>
      {(deck.customTags ?? []).length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {(deck.customTags ?? []).map((tag) => {
            const current = Object.entries(deck.cardTags ?? {}).filter(([, tags]) =>
              tags.includes(tag),
            ).length;
            const target = goals.tagTargets?.[tag];
            return (
              <label key={tag} className={cn("flex items-center gap-2", EDITOR_SUBTLE_BLOCK_CLASS)}>
                <span className="min-w-0 flex-1 truncate text-xs">{tag} target</span>
                <span
                  className={cn(
                    "text-xs font-mono",
                    target === undefined || current >= target
                      ? "text-legality-legal"
                      : "text-warning",
                  )}
                >
                  {current}
                </span>
                <Input
                  className="h-7 w-20 text-right text-xs"
                  type="number"
                  min="0"
                  value={target ?? ""}
                  onFocus={goalEdit.begin}
                  onChange={(event) => updateTagTarget(tag, event.target.value)}
                  onBlur={goalEdit.commit}
                  placeholder="Any"
                />
              </label>
            );
          })}
        </div>
      )}
    </section>
  );
}
