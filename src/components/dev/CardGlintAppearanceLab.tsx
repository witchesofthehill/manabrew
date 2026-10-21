import { useMemo, useState } from "react";
import { CardGlintInspect } from "@/components/editor/CardGlintInspect";
import { CardGlintAppearanceControls } from "@/components/dev/CardGlintAppearanceControls";
import { Button } from "@/components/ui/button";
import { CARD_FINISH_PRESETS, resolveCardFinish } from "@/lib/cardFinish";
import type { CardInspectAppearance } from "@/lib/cardGlintInspectAppearance";
import type { DeckCard } from "@/protocol/deck";
import { useCardFinishPreview } from "@/stores/useCardFinishPreview";
import { CardRenderingLightingControls } from "@/components/dev/CardRenderingLightingControls";
import type { CardLightingMode, CardPose } from "@/lib/cardLighting";

export function CardGlintAppearanceLab({
  card,
  faceIndex,
  onFlipFace,
  appearance,
  onAppearanceChange,
  lighting,
  pose,
  onLightingChange,
  onPoseChange,
}: {
  card: DeckCard;
  faceIndex: 0 | 1;
  onFlipFace: () => void;
  appearance: CardInspectAppearance;
  onAppearanceChange: (appearance: CardInspectAppearance) => void;
  lighting: CardLightingMode;
  pose: CardPose;
  onLightingChange: (lighting: CardLightingMode) => void;
  onPoseChange: (pose: CardPose) => void;
}) {
  const [copyState, setCopyState] = useState<{ copied?: string; failed?: string }>({});
  const mode = useCardFinishPreview((state) => state.mode);
  const foil = useCardFinishPreview((state) => state.foilAll);
  const finish = mode ?? resolveCardFinish(foil, card.identity.cosmetics);
  const preview = useMemo(
    () => ({
      ...card,
      identity: {
        ...card.identity,
        foil,
        cosmetics: { ...card.identity.cosmetics, finish },
      },
    }),
    [card, foil, finish],
  );
  const settings = JSON.stringify({ finish, ...appearance, lighting, pose }, null, 2);
  const update = (next: CardInspectAppearance) => {
    onAppearanceChange(next);
    setCopyState({});
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(settings);
      setCopyState({ copied: settings });
    } catch {
      setCopyState({ failed: settings });
    }
  };
  return (
    <section
      aria-label="Card Glint appearance workbench"
      className="space-y-4 rounded-lg border border-border bg-card p-3"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-semibold">Card Glint material workbench</h2>
          <p className="max-w-3xl text-xs text-muted-foreground">
            Coating, print dots, wear, fog and coverage also apply to the production comparisons
            below. Deformation, printing reflections and holograms affect only this native preview.
            Nothing is saved.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void copy()}>
            {copyState.copied === settings ? "Copied settings" : "Copy settings JSON"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={Object.keys(appearance).length === 0}
            onClick={() => update({})}
          >
            Reset material settings
          </Button>
        </div>
      </header>
      {copyState.failed === settings && (
        <p role="alert" className="text-xs text-destructive">
          Clipboard access failed. Select and copy the JSON below.
        </p>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(15rem,20rem)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-2 lg:sticky lg:top-3">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{CARD_FINISH_PRESETS.find((preset) => preset.id === finish)?.label}</span>
            <span>Native renderer</span>
          </div>
          <CardGlintInspect
            card={preview}
            appearance={appearance}
            faceIndex={faceIndex}
            onFlipFace={onFlipFace}
            lighting={lighting}
            pose={pose}
            onPoseChange={onPoseChange}
            className="rounded-md border border-border bg-background"
          />
          <p className="text-xs text-muted-foreground">
            Uses the selected printing. Live game-state edits below do not change this preview.
          </p>
        </div>
        <div className="min-w-0 space-y-3 lg:max-h-[38rem] lg:overflow-y-auto lg:overscroll-contain lg:pr-2">
          <CardRenderingLightingControls
            lighting={lighting}
            pose={pose}
            onLightingChange={onLightingChange}
            onPoseChange={onPoseChange}
          />
          <CardGlintAppearanceControls value={appearance} onChange={update} finish={finish} />
          <details
            open={copyState.failed === settings}
            className="rounded-md border border-border p-3"
          >
            <summary className="cursor-pointer text-xs font-medium">
              Candidate settings JSON
            </summary>
            <textarea
              aria-label="Card Glint lab settings JSON"
              readOnly
              value={settings}
              rows={10}
              className="mt-3 w-full resize-y rounded-md border border-input bg-background p-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onFocus={(event) => event.currentTarget.select()}
            />
          </details>
        </div>
      </div>
    </section>
  );
}
