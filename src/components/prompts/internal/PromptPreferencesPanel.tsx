import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { PromptType } from "@/protocol";
import { usePromptPreferencesStore } from "@/stores/usePromptPreferencesStore";

interface OptionalCostRow {
  promptType: PromptType;
  label: string;
  description: string;
}

const OPTIONAL_COST_ROWS: OptionalCostRow[] = [
  {
    promptType: "chooseKicker",
    label: "Kicker",
    description: "Skip the kicker prompt — never pay the extra cost.",
  },
  {
    promptType: "chooseBuyback",
    label: "Buyback",
    description: "Skip the buyback prompt — never pay the buyback cost.",
  },
  {
    promptType: "chooseMultikicker",
    label: "Multikicker",
    description: "Skip the multikicker prompt — default to 0 kicks.",
  },
  {
    promptType: "chooseReplicate",
    label: "Replicate",
    description: "Skip the replicate prompt — default to 0 copies.",
  },
  {
    promptType: "chooseDelve",
    label: "Delve",
    description: "Skip the delve prompt — never exile cards from the graveyard.",
  },
  {
    promptType: "chooseConvoke",
    label: "Convoke",
    description: "Skip the convoke prompt — never tap creatures for mana.",
  },
  {
    promptType: "chooseImprovise",
    label: "Improvise",
    description: "Skip the improvise prompt — never tap artifacts for mana.",
  },
  {
    promptType: "chooseExertAttackers",
    label: "Exert",
    description: "Skip the exert prompt — never exert attackers.",
  },
  {
    promptType: "chooseEnlistAttackers",
    label: "Enlist",
    description: "Skip the enlist prompt — never enlist creatures.",
  },
  {
    promptType: "helpPayAssist",
    label: "Help pay (Assist)",
    description: "Skip the assist prompt — never offer to help pay.",
  },
];

export function PromptPreferencesPanel() {
  const showOverrides = usePromptPreferencesStore((s) => s.show);
  const triggerMemory = usePromptPreferencesStore((s) => s.triggerMemory);
  const setShow = usePromptPreferencesStore((s) => s.setShow);
  const clearShow = usePromptPreferencesStore((s) => s.clearShow);
  const resetForNewGame = usePromptPreferencesStore((s) => s.resetForNewGame);

  const rememberedCount = Object.keys(triggerMemory).length;

  function setOptionalCostSkip(promptType: PromptType, skip: boolean) {
    if (skip) setShow(promptType, false);
    else clearShow(promptType);
  }

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">Prompts</h2>
        <p className="text-xs text-muted-foreground max-w-prose">
          The auto-resolver answers prompts that have a single legal answer (target, mode, …) and
          informational acks (RevealCards, dice rolls). Those are always automatic — no toggle. The
          list below covers optional costs you may prefer to never be asked about.
        </p>
      </header>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Auto-skip optional costs</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {OPTIONAL_COST_ROWS.map((row) => {
            const skipped = showOverrides[row.promptType] === false;
            const id = `prompt-skip-${row.promptType}`;
            return (
              <div
                key={row.promptType}
                className="rounded-lg border bg-card/40 p-3 flex items-start gap-3"
              >
                <input
                  id={id}
                  type="checkbox"
                  checked={skipped}
                  onChange={(e) => setOptionalCostSkip(row.promptType, e.target.checked)}
                  className="mt-1 accent-primary h-4 w-4"
                />
                <div className="space-y-1">
                  <Label htmlFor={id}>{row.label}</Label>
                  <p className="text-xs text-muted-foreground">{row.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Triggered ability memory</h3>
        <div className="rounded-lg border bg-card/40 p-3 flex items-start justify-between gap-4">
          <div className="space-y-1 max-w-prose">
            <p className="text-sm">
              {rememberedCount > 0
                ? `${rememberedCount} source card${rememberedCount === 1 ? "" : "s"} remembered for this game.`
                : "No remembered answers for the current game."}
            </p>
            <p className="text-xs text-muted-foreground">
              The "Always yes / Always no" buttons in the optional-trigger modal write to this
              memory. It clears automatically at the start of every new game; clear it manually if
              you want to be asked again right away.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={resetForNewGame}
            disabled={rememberedCount === 0}
          >
            Forget all
          </Button>
        </div>
      </div>
    </section>
  );
}
