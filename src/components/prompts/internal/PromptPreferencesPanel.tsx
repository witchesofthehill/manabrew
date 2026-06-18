import { useState } from "react";

import { Label } from "@/components/ui/label";
import type { PromptType } from "@/protocol";
import { usePromptPreferencesStore } from "@/stores/usePromptPreferencesStore";
import { isPromptLoggingEnabled, setPromptLoggingEnabled } from "@/lib/debugPrompts";

interface OptionalCostRow {
  promptType: PromptType;
  label: string;
  description: string;
}

const OPTIONAL_COST_ROWS: OptionalCostRow[] = [
  {
    promptType: "chooseBoolean",
    label: "Optional yes/no costs",
    description:
      "Skip yes/no cost prompts (kicker, buyback, Phyrexian) — never pay the extra cost.",
  },
  {
    promptType: "chooseDelve",
    label: "Delve",
    description: "Skip the delve prompt — never exile cards from the graveyard.",
  },
];

export function PromptPreferencesPanel() {
  const showOverrides = usePromptPreferencesStore((s) => s.show);
  const setShow = usePromptPreferencesStore((s) => s.setShow);
  const clearShow = usePromptPreferencesStore((s) => s.clearShow);

  const [logPrompts, setLogPrompts] = useState(isPromptLoggingEnabled);

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
        <h3 className="text-sm font-semibold">Debug</h3>
        <div className="rounded-lg border bg-card/40 p-3 flex items-start gap-3">
          <input
            id="prompt-debug-log"
            type="checkbox"
            checked={logPrompts}
            onChange={(e) => {
              setPromptLoggingEnabled(e.target.checked);
              setLogPrompts(e.target.checked);
            }}
            className="mt-1 accent-primary h-4 w-4"
          />
          <div className="space-y-1">
            <Label htmlFor="prompt-debug-log">Log prompts to console</Label>
            <p className="text-xs text-muted-foreground">
              Print every prompt the UI receives (not state updates) to the dev console, including
              the full JSON. Useful for reporting prompt issues.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
