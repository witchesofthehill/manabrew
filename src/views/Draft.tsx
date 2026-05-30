import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import LimitedDeckBuilder from "@/components/limited/LimitedDeckBuilder";
import { DraftCardTile } from "@/components/limited/DraftCardTile";
import { LimitedHoverPreviewPane } from "@/components/limited/LimitedHoverPreviewPane";
import { LimitedModeToggle, type LimitedDraftMode } from "@/components/limited/LimitedModeToggle";
import { RaritySetBadge } from "@/components/limited/RaritySetBadge";
import { useCardPreview } from "@/hooks/useCardPreview";
import { useLimitedStore } from "@/stores/useLimitedStore";
import type { DraftCard } from "@/types/limited";

type DraftMode = LimitedDraftMode;

export default function Draft() {
  const { draftId } = useParams<{ draftId: string }>();
  const navigate = useNavigate();
  const activeDraft = useLimitedStore((s) => s.activeDraft);
  const pick = useLimitedStore((s) => s.pickDraftCard);
  const undo = useLimitedStore((s) => s.undoDraftPick);
  const refresh = useLimitedStore((s) => s.refreshDraftState);
  const conspiracyHooks = useLimitedStore((s) => s.conspiracyHooks);
  const fetchConspiracyHooks = useLimitedStore((s) => s.fetchConspiracyHooks);
  const lastError = useLimitedStore((s) => s.lastError);

  const [userMode, setUserMode] = useState<DraftMode>("drafting");

  useEffect(() => {
    if (!draftId) return;
    if (!activeDraft || activeDraft.sessionId !== draftId) {
      refresh(draftId);
    }
  }, [draftId, activeDraft, refresh]);

  useEffect(() => {
    if (conspiracyHooks.length === 0) {
      fetchConspiracyHooks();
    }
  }, [conspiracyHooks.length, fetchConspiracyHooks]);

  // Derive the effective mode — the draft being complete forces the
  // builder, otherwise the user's selection wins. Computed in render
  // so we avoid the setState-in-effect anti-pattern.
  const mode: DraftMode = activeDraft?.isComplete ? "building" : userMode;

  if (!activeDraft) {
    return (
      <div className="flex h-full items-center justify-center">
        {lastError ? (
          <p className="text-destructive">{lastError}</p>
        ) : (
          <p className="text-muted-foreground">Loading draft…</p>
        )}
      </div>
    );
  }

  const handlePick = async (card: DraftCard) => {
    if (!draftId || !activeDraft.awaitingHuman) return;
    try {
      await pick(draftId, card.name);
    } catch {
      /* surfaced via lastError */
    }
  };

  const handleUndo = async () => {
    if (!draftId) return;
    try {
      await undo(draftId);
    } catch {
      /* surfaced via lastError */
    }
  };

  const canBuild = activeDraft.pickedPile.length >= 1;

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Booster Draft</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>
              Round {activeDraft.round} / {activeDraft.totalRounds} · Pick {activeDraft.pickNumber}
            </span>
            {activeDraft.isComplete ? (
              <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                Complete
              </span>
            ) : activeDraft.awaitingHuman ? (
              <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                {activeDraft.picksPerPass > 1 && activeDraft.picksRemainingInPack > 0
                  ? `Your pick (${activeDraft.picksRemainingInPack} of ${activeDraft.picksPerPass})`
                  : "Your pick"}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded bg-muted/60 px-1.5 py-0.5 text-[11px] font-medium">
                <Loader2 className="h-3 w-3 animate-spin" />
                AI thinking…
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canBuild && !activeDraft.isComplete && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleUndo}
              className="h-8 px-2 text-xs"
              title="Undo your last pick"
            >
              Undo pick
            </Button>
          )}
          {canBuild && (
            <LimitedModeToggle
              mode={mode}
              onChange={setUserMode}
              disableDrafting={activeDraft.isComplete}
            />
          )}
          <Button variant="outline" onClick={() => navigate("/limited")}>
            Back
          </Button>
        </div>
      </header>

      {mode === "building" ? (
        <div className="min-h-0 flex-1">
          <LimitedDeckBuilder
            pool={activeDraft.pickedPile}
            defaultDeckName="Booster Draft Deck"
            format="draft"
          />
        </div>
      ) : (
        <DraftingView
          activeDraft={activeDraft}
          onPick={handlePick}
          onJumpToBuild={() => setUserMode("building")}
          canBuild={canBuild}
          conspiracyHooks={conspiracyHooks}
        />
      )}

      {lastError && (
        <p className="rounded border border-destructive/70 bg-destructive/10 p-3 text-sm text-destructive">
          {lastError}
        </p>
      )}
    </div>
  );
}

export interface DraftingViewProps {
  activeDraft: import("@/types/limited").DraftState;
  onPick: (card: DraftCard) => void;
  onJumpToBuild?: () => void;
  canBuild?: boolean;
  conspiracyHooks: ReturnType<typeof useLimitedStore.getState>["conspiracyHooks"];
}

export function DraftingView({
  activeDraft,
  onPick,
  onJumpToBuild,
  canBuild = false,
  conspiracyHooks,
}: DraftingViewProps) {
  const preview = useCardPreview();
  return (
    <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-[1fr_minmax(0,340px)]">
      <div className="overflow-y-auto rounded-md border border-border/70 p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Current Pack ({activeDraft.currentPack.length})
        </h2>
        {activeDraft.currentPack.length === 0 ? (
          <p className="text-sm text-muted-foreground">Pack empty.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {activeDraft.currentPack.map((c, i) => (
              <DraftCardTile
                key={`${c.setCode}:${c.cardNumber}:${c.name}:${i}`}
                card={c}
                index={i}
                onClick={() => onPick(c)}
                disabled={!activeDraft.awaitingHuman}
                preview={preview}
                overlay={<RaritySetBadge card={c} />}
              />
            ))}
          </div>
        )}
      </div>

      <aside className="flex min-h-0 flex-col gap-4">
        <LimitedHoverPreviewPane preview={preview} className="hidden lg:block" />
        {activeDraft.humanConspiracies && activeDraft.humanConspiracies.length > 0 && (
          <section className="rounded-md border border-purple-500/40 bg-purple-500/10 p-3 text-xs">
            <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-purple-200">
              Conspiracies armed ({activeDraft.humanConspiracies.length})
            </h2>
            <ul className="space-y-1">
              {activeDraft.humanConspiracies.map((name) => {
                const hook = conspiracyHooks.find((h) => h.cardName === name);
                return (
                  <li key={name} className="rounded bg-purple-400/15 px-2 py-1.5 text-purple-100">
                    <div className="font-medium">{name}</div>
                    {hook && (
                      <div className="text-[10px] text-purple-200/80">{hook.description}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        <section className="flex min-h-0 flex-1 flex-col rounded-md border border-border/70">
          <div className="flex items-center justify-between border-b border-border/40 px-4 py-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Your Pile ({activeDraft.pickedPile.length})
            </h2>
            {canBuild && (
              <Button size="sm" variant="outline" onClick={onJumpToBuild} className="h-7 text-xs">
                Build
              </Button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {activeDraft.pickedPile.length === 0 ? (
              <p className="text-xs text-muted-foreground">No picks yet.</p>
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {activeDraft.pickedPile.map((c, i) => (
                  <DraftCardTile
                    key={`picked-${i}`}
                    card={c}
                    index={i}
                    preview={preview}
                    overlay={
                      <span
                        className="pointer-events-none absolute right-1 top-1 rounded-full border border-white/20 bg-black/70 px-1.5 py-0.5 text-[9px] font-bold text-white/90"
                        title={`Pick #${i + 1}`}
                      >
                        #{i + 1}
                      </span>
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="shrink-0 rounded-md border border-border/70 p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Pod
          </h2>
          <ul className="space-y-1 text-sm">
            {activeDraft.seatSummaries.map((s) => (
              <li key={s.seat} className="flex items-center justify-between">
                <span className={s.isHuman ? "font-semibold" : ""}>
                  {s.seat}. {s.name}
                </span>
                <span className="text-muted-foreground">
                  {s.picksMade} pick{s.picksMade === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}
