import { Compass } from "lucide-react";

import { isLand } from "@/lib/mana";
import { useCardRolesStore, CARD_ROLE_LABELS } from "@/stores/useCardRolesStore";
import type { EditorDeck } from "@/types/manabrew";

export function DeckIntentPanel({ deck }: { deck: EditorDeck }) {
  const roles = useCardRolesStore((state) => state.roles);
  const spells = deck.cards.filter((card) => !isLand(card.types));
  if (spells.length === 0) return null;

  const roleCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  for (const card of spells) {
    for (const role of roles[card.identity.name.toLowerCase()] ?? []) {
      roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
    }
    for (const type of card.types) typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
  }
  const leadingRoles = [...roleCounts]
    .filter(([role]) => role !== "interaction")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const leadingType = [...typeCounts].sort((a, b) => b[1] - a[1])[0];
  const averageMana = spells.reduce((sum, card) => sum + card.cmc, 0) / spells.length;
  const pace = averageMana <= 2.4 ? "fast" : averageMana >= 3.6 ? "deliberate" : "midrange";
  const commanderNames = (deck.commanders ?? []).map((card) => card.identity.name);
  const sentences = [
    commanderNames.length > 0
      ? `Built around ${commanderNames.join(" and ")}.`
      : `A ${pace} ${deck.format ?? "constructed"} list with a ${averageMana.toFixed(1)} average mana value.`,
    leadingRoles.length > 0
      ? `Its strongest structural themes are ${leadingRoles.map(([role]) => CARD_ROLE_LABELS[role]?.toLowerCase() ?? role).join(", ")}.`
      : null,
    leadingType && leadingType[1] >= Math.max(8, spells.length * 0.25)
      ? `${leadingType[0]} cards form the main permanent package (${leadingType[1]} cards).`
      : null,
  ].filter(Boolean);

  return (
    <section className="rounded-xl border bg-card/40 p-5">
      <div className="flex items-center gap-2">
        <Compass className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Deck intent</h3>
        <span className="text-[10px] text-muted-foreground">local analysis</span>
      </div>
      <p className="mt-3 max-w-4xl text-sm leading-relaxed text-muted-foreground">
        {sentences.join(" ")}
      </p>
      {leadingRoles.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {leadingRoles.map(([role, count]) => (
            <span key={role} className="rounded-full border bg-background/40 px-2.5 py-1 text-xs">
              {CARD_ROLE_LABELS[role] ?? role} · {count}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
