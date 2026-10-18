import { useMemo } from "react";
import { GeneratedCardImage } from "@/components/game/GeneratedCardImage";
import {
  customizationPreview,
  type CardCustomizationDraft,
} from "@/components/editor/cardCustomizerDraft";
import {
  CARD_FINISH_PRESETS,
  CARD_FRAME_PRESETS,
  CARD_BORDER_PRESETS,
  CARD_WEAR_PRESETS,
  resolveCardWearAmount,
} from "@/lib/cardFinish";
import { cn } from "@/lib/utils";
import type { DeckCard } from "@/protocol/deck";
import type { EditorDeck } from "@/types/manabrew";

export function CardCustomizerCopies({
  deck,
  copies,
  activeId,
  selectedIds,
  pendingIds,
  drafts,
  disabled,
  onSelect,
  onToggle,
}: {
  deck: EditorDeck;
  copies: readonly DeckCard[];
  activeId: string;
  selectedIds: ReadonlySet<string>;
  pendingIds: ReadonlySet<string>;
  drafts: ReadonlyMap<string, CardCustomizationDraft>;
  disabled: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const sections = useMemo(() => {
    const groups: readonly [string, readonly DeckCard[]][] = [
      ["Main", deck.cards],
      ["Sideboard", deck.sideboard],
      ["Maybeboard", deck.maybeboard ?? []],
      ["Command zone", deck.commanders ?? []],
      ["Companion", deck.companion ? [deck.companion] : []],
      ["Attractions", deck.attractions ?? []],
      ["Contraptions", deck.contraptions ?? []],
      ["Schemes", deck.schemes ?? []],
      ["Planes", deck.planes ?? []],
    ];
    return new Map(
      groups.flatMap(([section, cards]) =>
        cards.map((copy) => [copy.identity.id, section] as const),
      ),
    );
  }, [deck]);
  return (
    <section className="mt-5 min-w-0 space-y-3 border-t pt-4" aria-label="Copies in this deck">
      <h3 className="text-sm font-semibold">Copies in this deck · {copies.length}</h3>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {copies.map((copy, index) => {
          const id = copy.identity.id;
          const selected = selectedIds.has(id);
          const preview = customizationPreview(copy, drafts);
          const cosmetics = preview.identity.cosmetics;
          const settings = [
            CARD_FINISH_PRESETS.find((preset) => preset.id === cosmetics?.finish)?.label ??
              "Printing default",
            CARD_FRAME_PRESETS.find((preset) => preset.id === (cosmetics?.frame ?? "printing"))
              ?.label,
            CARD_BORDER_PRESETS.find((preset) => preset.id === (cosmetics?.border ?? "printing"))
              ?.label,
            typeof cosmetics?.wearAmount === "number" && Number.isFinite(cosmetics.wearAmount)
              ? `${(resolveCardWearAmount(cosmetics) * 100).toFixed(1)}% wear`
              : CARD_WEAR_PRESETS.find((preset) => preset.id === (cosmetics?.wear ?? "fresh"))
                  ?.label,
          ].join(" · ");
          const name = `Copy ${index + 1}, ${sections.get(id)}, ${copy.identity.setCode.toUpperCase()} #${copy.identity.cardNumber}`;
          return (
            <li
              key={id}
              className={cn(
                "min-w-0 rounded-lg border p-2",
                selected ? "border-primary bg-primary/5" : "border-border bg-muted/20",
              )}
            >
              <button
                type="button"
                className="block w-full rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                aria-label={`Inspect ${name}`}
                aria-pressed={activeId === id}
                disabled={disabled}
                onClick={() => onSelect(id)}
              >
                <GeneratedCardImage
                  deckCard={preview}
                  loading="lazy"
                  className="w-full rounded-md"
                />
                <span className="mt-1 block text-xs font-medium">
                  Copy {index + 1} · {sections.get(id)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {copy.identity.setCode.toUpperCase()} #{copy.identity.cardNumber} ·{" "}
                  {preview.identity.foil ? "Foil" : "Nonfoil"}
                </span>
                <span className="block text-xs text-muted-foreground">{settings}</span>
                <span
                  className={cn(
                    "block text-xs",
                    pendingIds.has(id) ? "font-medium text-primary" : "text-muted-foreground",
                  )}
                >
                  {pendingIds.has(id) ? "Pending changes" : "Unchanged"}
                  {activeId === id ? " · Inspecting" : ""}
                </span>
              </button>
              <label className="mt-1 flex min-h-8 cursor-pointer items-center gap-1.5 text-xs pointer-coarse:min-h-11">
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={disabled}
                  onChange={() => onToggle(id)}
                  aria-label={`Select ${name} for editing`}
                  className="size-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                Selected
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
