import { Loader2 } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { scryfallToDeckCard } from "@/lib/scryfall.utils";
import { useGameDevStore } from "@/stores/useGameDevStore";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { PREVIEW_SCENARIOS } from "./devPreviewScenarios";
import { Button } from "@/components/ui/button";

import {
  DEV_CONTROL_ACTIVE,
  DEV_CONTROL_BUTTON,
  DEV_CONTROL_INACTIVE,
  DEV_SECTION,
  DEV_SECTION_HEADING,
} from "./devPanel.styles";

export function DevCardLayoutControls() {
  const definition = useGameDevStore((s) => s.debugCardDefinition);
  const transformed = useGameDevStore((s) => s.cardOverrides.forceTransformed);
  const setDebugCard = useGameDevStore((s) => s.setDebugCard);
  const setDebugCardEnabled = useGameDevStore((s) => s.setDebugCardEnabled);
  const setCardOverride = useGameDevStore((s) => s.setCardOverride);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewStyle = usePreferencesStore((s) => s.inGameCardPreviewStyle);
  const setPreviewStyle = usePreferencesStore((s) => s.setInGameCardPreviewStyle);

  const selectLayout = async (scenario: (typeof PREVIEW_SCENARIOS)[number]) => {
    setLoadingId(scenario.label);
    setError(null);
    try {
      const { info } = await useScryfallStore
        .getState()
        .getCard({ name: scenario.name || "Serra Angel" });
      const card = scryfallToDeckCard(info);
      setDebugCard(
        scenario.name
          ? card
          : {
              ...card,
              identity: { ...card.identity, name: "", setCode: "", cardNumber: "" },
              text: "",
              manaCost: "",
              types: ["Creature"],
              subtypes: [],
              supertypes: [],
              power: "2",
              toughness: "2",
              keywords: [],
            },
      );
      setCardOverride("forceTransformed", !!scenario.back);
      setCardOverride("forceFaceDown", !scenario.name);
      setDebugCardEnabled(true);
    } catch {
      setError(`Could not load ${scenario.label}.`);
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <section className={DEV_SECTION}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={DEV_SECTION_HEADING}>Card layouts and previews</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Stage a scenario, then hover the staged card. Use its flip and rotate buttons to inspect
            each face.
          </p>
        </div>
        {definition?.layout ? (
          <span className="rounded-full bg-muted px-2 py-1 font-mono text-[10px] text-muted-foreground">
            {definition.layout}
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={previewStyle === "rules" ? "default" : "outline"}
          onClick={() => setPreviewStyle("rules")}
        >
          Rules preview
        </Button>
        <Button
          size="sm"
          variant={previewStyle === "printed" ? "default" : "outline"}
          onClick={() => setPreviewStyle("printed")}
        >
          Printed preview
        </Button>
        {import.meta.env.DEV && (
          <Button size="sm" variant="outline" asChild>
            <a href="/card-mock" target="_blank" rel="noopener noreferrer">
              Open preview playground
            </a>
          </Button>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        {PREVIEW_SCENARIOS.map((layoutCase) => {
          const active =
            definition?.identity.name === layoutCase.name.split(" // ")[0] &&
            transformed === !!layoutCase.back;
          return (
            <button
              key={layoutCase.label}
              type="button"
              className={cn(
                DEV_CONTROL_BUTTON,
                "flex items-center justify-center gap-1.5",
                active ? DEV_CONTROL_ACTIVE : DEV_CONTROL_INACTIVE,
              )}
              disabled={loadingId !== null}
              onClick={() => void selectLayout(layoutCase)}
              title={layoutCase.name || "Face-down card"}
            >
              {loadingId === layoutCase.label ? (
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
