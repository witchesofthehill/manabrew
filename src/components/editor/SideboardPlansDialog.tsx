import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useDeckStore } from "@/stores/useDeckStore";
import type { DeckSideboardPlan } from "@/types/manabrew";
import { executeDeckEdit } from "./deckEditor.history";
import { useDeckEditTransaction } from "./useDeckEditTransaction";

export function SideboardPlansDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const metadata = useDeckStore((state) => state.currentDeck.editor);
  const setEditorMetadata = useDeckStore((state) => state.setEditorMetadata);
  const [matchup, setMatchup] = useState("");
  const plans = metadata?.sideboardPlans ?? [];
  const planEdit = useDeckEditTransaction("Edit sideboard plan");

  function updatePlans(next: DeckSideboardPlan[]) {
    setEditorMetadata({
      ...metadata,
      version: 1,
      tags: metadata?.tags ?? [],
      layouts: metadata?.layouts ?? [],
      sideboardPlans: next,
    });
  }

  function addPlan() {
    const name = matchup.trim();
    if (!name) return;
    executeDeckEdit("Add sideboard plan", () =>
      updatePlans([
        ...plans,
        { id: crypto.randomUUID(), matchup: name, bringIn: "", takeOut: "", notes: "" },
      ]),
    );
    setMatchup("");
  }

  function updatePlan(id: string, patch: Partial<DeckSideboardPlan>) {
    updatePlans(plans.map((plan) => (plan.id === id ? { ...plan, ...patch } : plan)));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sideboard plans</DialogTitle>
          <DialogDescription>
            Keep the exact swaps and play-pattern notes you need for each matchup.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input
            value={matchup}
            placeholder="Azorius Control"
            onChange={(event) => setMatchup(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addPlan();
            }}
          />
          <Button disabled={!matchup.trim()} onClick={addPlan}>
            <Plus className="mr-1.5 h-4 w-4" /> Matchup
          </Button>
        </div>
        <div className="space-y-3">
          {plans.map((plan) => (
            <section key={plan.id} className="rounded-xl border bg-card/40 p-4">
              <div className="flex items-center gap-2">
                <Input
                  className="h-8 font-semibold"
                  value={plan.matchup}
                  onFocus={planEdit.begin}
                  onChange={(event) => updatePlan(plan.id, { matchup: event.target.value })}
                  onBlur={planEdit.commit}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Delete ${plan.matchup}`}
                  onClick={() =>
                    executeDeckEdit("Delete sideboard plan", () =>
                      updatePlans(plans.filter((candidate) => candidate.id !== plan.id)),
                    )
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-medium">
                  Bring in
                  <textarea
                    className="mt-1 min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 text-xs"
                    value={plan.bringIn}
                    placeholder="2 Negate\n1 Rest in Peace"
                    onFocus={planEdit.begin}
                    onChange={(event) => updatePlan(plan.id, { bringIn: event.target.value })}
                    onBlur={planEdit.commit}
                  />
                </label>
                <label className="text-xs font-medium">
                  Take out
                  <textarea
                    className="mt-1 min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 text-xs"
                    value={plan.takeOut}
                    placeholder="2 slow removal\n1 top-end threat"
                    onFocus={planEdit.begin}
                    onChange={(event) => updatePlan(plan.id, { takeOut: event.target.value })}
                    onBlur={planEdit.commit}
                  />
                </label>
              </div>
              <label className="mt-3 block text-xs font-medium">
                Matchup notes
                <textarea
                  className="mt-1 min-h-16 w-full resize-y rounded-md border bg-background px-3 py-2 text-xs"
                  value={plan.notes}
                  placeholder="What matters after boarding?"
                  onFocus={planEdit.begin}
                  onChange={(event) => updatePlan(plan.id, { notes: event.target.value })}
                  onBlur={planEdit.commit}
                />
              </label>
            </section>
          ))}
          {plans.length === 0 && (
            <p className="py-8 text-center text-xs text-muted-foreground">
              Add a matchup to start a sideboard guide.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
