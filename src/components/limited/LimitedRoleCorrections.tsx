import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  LIMITED_ROLE_LABELS,
  LIMITED_ROLES,
  type AnalyzedLimitedCard,
} from "@/components/limited/limitedPoolAnalysis.utils";
import { useLimitedAnalysisStore } from "@/components/limited/useLimitedAnalysisStore";

export function LimitedRoleCorrections({
  sessionKey,
  cards,
}: {
  sessionKey: string;
  cards: AnalyzedLimitedCard[];
}) {
  const [search, setSearch] = useState("");
  const overrides = useLimitedAnalysisStore((state) => state.overrides[sessionKey]);
  const filtered = cards.filter((card) =>
    card.card.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <details className="rounded border border-border p-3 text-xs">
      <summary className="cursor-pointer font-semibold">
        Classification and role corrections
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-muted-foreground">
          Creature roles use the front-face type. Interaction matches Oracle removal, countering,
          bounce, damage and attack/block restrictions. Fixing matches multiple-color land sources,
          any-color mana, land searches and Treasure. These are text-based suggestions, not power
          ratings. Choose a card's roles when the suggestion misses its job in this pool.
        </p>
        <p className="text-muted-foreground">
          Corrections belong to this session and physical card. They survive reloads and do not move
          cards, change mana costs or turn unsupported abilities into unconditional sources. Reset
          returns to the metadata suggestion.
        </p>
        <Input
          aria-label="Find card to correct roles"
          placeholder="Find a card"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="max-h-72 overflow-y-auto">
          {filtered.length === 0 && <p className="p-2 text-muted-foreground">No matching cards.</p>}
          {filtered.map((card) => (
            <div
              key={card.card.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border py-3"
            >
              <div className="min-w-0 flex-1 basis-40">
                <p className="font-medium">{card.card.name}</p>
                <p className="text-muted-foreground">
                  {card.card.setCode.toUpperCase()} {card.card.cardNumber}
                  {card.card.foil ? " · Foil" : ""}
                  {!card.known ? " · Metadata unavailable" : ""}
                </p>
              </div>
              {LIMITED_ROLES.map((role) => (
                <label key={role} className="flex min-h-8 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={card.roles[role]}
                    onChange={(event) =>
                      useLimitedAnalysisStore
                        .getState()
                        .setRole(sessionKey, card.card.id, role, event.target.checked)
                    }
                  />
                  {LIMITED_ROLE_LABELS[role]}
                </label>
              ))}
              <Button
                variant="ghost"
                size="sm"
                disabled={!overrides?.[card.card.id]}
                onClick={() =>
                  useLimitedAnalysisStore.getState().resetCard(sessionKey, card.card.id)
                }
              >
                Reset
              </Button>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
