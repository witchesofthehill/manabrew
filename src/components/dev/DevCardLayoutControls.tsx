import { Loader2 } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { scryfallToDeckCard } from "@/lib/scryfall.utils";
import { useGameDevStore } from "@/stores/useGameDevStore";
import { useScryfallStore } from "@/stores/useScryfallStore";

import {
  DEV_CONTROL_ACTIVE,
  DEV_CONTROL_BUTTON,
  DEV_CONTROL_INACTIVE,
  DEV_SECTION,
  DEV_SECTION_HEADING,
} from "./devPanel.styles";

const LAYOUT_CASES = [
  {
    id: "transform",
    label: "Transform",
    cardName: "Delver of Secrets",
    identityName: "Delver of Secrets",
  },
  {
    id: "modal_dfc",
    label: "Modal DFC",
    cardName: "Kazuul's Fury",
    identityName: "Kazuul's Fury",
  },
  { id: "split", label: "Split", cardName: "Fire // Ice", identityName: "Fire" },
  {
    id: "adventure",
    label: "Adventure",
    cardName: "Bonecrusher Giant",
    identityName: "Bonecrusher Giant",
  },
  {
    id: "room",
    label: "Room",
    cardName: "Dollmaker's Shop // Porcelain Gallery",
    identityName: "Dollmaker's Shop",
  },
  {
    id: "battle",
    label: "Battle",
    cardName: "Invasion of Zendikar",
    identityName: "Invasion of Zendikar",
  },
  {
    id: "prototype",
    label: "Prototype",
    cardName: "Phyrexian Fleshgorger",
    identityName: "Phyrexian Fleshgorger",
  },
  {
    id: "meld",
    label: "Meld",
    cardName: "Bruna, the Fading Light",
    identityName: "Bruna, the Fading Light",
  },
] as const;

export function DevCardLayoutControls() {
  const definition = useGameDevStore((s) => s.debugCardDefinition);
  const transformed = useGameDevStore((s) => s.cardOverrides.forceTransformed);
  const setDebugCard = useGameDevStore((s) => s.setDebugCard);
  const setDebugCardEnabled = useGameDevStore((s) => s.setDebugCardEnabled);
  const setCardOverride = useGameDevStore((s) => s.setCardOverride);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectLayout = async (layoutCase: (typeof LAYOUT_CASES)[number]) => {
    setLoadingId(layoutCase.id);
    setError(null);
    try {
      const card = await useScryfallStore.getState().getCard({ name: layoutCase.cardName });
      setDebugCard(scryfallToDeckCard(card.info));
      setCardOverride("forceTransformed", false);
      setDebugCardEnabled(true);
    } catch {
      setError(`Could not load ${layoutCase.label}.`);
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <section className={DEV_SECTION}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={DEV_SECTION_HEADING}>Card layouts</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Stage a known card for each unusual Scryfall layout.
          </p>
        </div>
        {definition?.layout ? (
          <span className="rounded-full bg-muted px-2 py-1 font-mono text-[10px] text-muted-foreground">
            {definition.layout}
          </span>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {LAYOUT_CASES.map((layoutCase) => {
          const active = definition?.identity.name === layoutCase.identityName;
          return (
            <button
              key={layoutCase.id}
              type="button"
              className={cn(
                DEV_CONTROL_BUTTON,
                "flex items-center justify-center gap-1.5",
                active ? DEV_CONTROL_ACTIVE : DEV_CONTROL_INACTIVE,
              )}
              disabled={loadingId !== null}
              onClick={() => void selectLayout(layoutCase)}
              title={layoutCase.cardName}
            >
              {loadingId === layoutCase.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              {layoutCase.label}
            </button>
          );
        })}
      </div>

      {definition?.backFace ? (
        <div className="mt-3 grid grid-cols-2 gap-1.5 border-t border-border/50 pt-3">
          <button
            type="button"
            className={cn(
              DEV_CONTROL_BUTTON,
              !transformed ? DEV_CONTROL_ACTIVE : DEV_CONTROL_INACTIVE,
            )}
            onClick={() => setCardOverride("forceTransformed", false)}
          >
            Front: {definition.identity.name}
          </button>
          <button
            type="button"
            className={cn(
              DEV_CONTROL_BUTTON,
              transformed ? DEV_CONTROL_ACTIVE : DEV_CONTROL_INACTIVE,
            )}
            onClick={() => setCardOverride("forceTransformed", true)}
          >
            Back: {definition.backFace.name}
          </button>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </section>
  );
}
