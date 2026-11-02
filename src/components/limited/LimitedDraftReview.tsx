import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LimitedCardCanvas } from "@/components/limited/LimitedCardCanvas";
import { LimitedReviewBuilds } from "@/components/limited/LimitedReviewBuilds";
import { useLimitedSavedSession } from "@/components/limited/useLimitedSavedSession";
import { exportLimitedReview, limitedReviewCards } from "@/game/limitedReview";

interface LimitedDraftReviewProps {
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LimitedDraftReview(props: LimitedDraftReviewProps) {
  return <LimitedDraftReviewContent key={`${props.sessionId}:${props.open}`} {...props} />;
}

function LimitedDraftReviewContent({ sessionId, open, onOpenChange }: LimitedDraftReviewProps) {
  const { saved, error: loadError } = useLimitedSavedSession(open ? sessionId : null);
  const [requestedIndex, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewPortalTarget, setPreviewPortalTarget] = useState<HTMLDivElement | null>(null);
  const history = saved?.history ?? [];
  const rounds = useMemo(
    () => [...new Set((saved?.history ?? []).map((decision) => decision.round))],
    [saved?.history],
  );
  const index = Math.min(requestedIndex, Math.max(0, history.length - 1));
  const decision = history[index];
  const acquired = saved ? limitedReviewCards(saved) : [];
  const unseenSelected = decision
    ? acquired.filter(
        (card) =>
          decision.selectedIds.includes(card.id) &&
          !decision.visibleCards.some((visible) => visible.id === card.id),
      )
    : [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={setPreviewPortalTarget}
        className="flex max-w-5xl flex-col overflow-y-auto overscroll-contain"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {saved?.kind === "winston" ? "Winston" : saved?.kind === "sealed" ? "Sealed" : "Draft"}{" "}
            review
          </DialogTitle>
          <DialogDescription>
            {saved
              ? `${saved.title} · ${saved.complete ? "Finished" : "Live"} · Your seat ${saved.seat + 1}`
              : "Loading the local review..."}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-16 space-y-4 overflow-y-auto overscroll-contain">
          {(loadError || error) && (
            <p className="text-ui-meta text-destructive">{loadError || error}</p>
          )}
          {saved && (
            <p className="text-ui-meta text-muted-foreground">
              This review contains only your visible decisions and acquired pool. Private engine
              checkpoints and other seats' pools are never exported.
            </p>
          )}
          {decision ? (
            <section className="grid gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <AppSelect
                  value={String(decision.round)}
                  onValueChange={(round) =>
                    setIndex(history.findIndex((item) => item.round === Number(round)))
                  }
                  aria-label={saved?.kind === "winston" ? "Winston turn" : "Booster round"}
                >
                  {rounds.map((round) => (
                    <AppSelectOption key={round} value={String(round)}>
                      {saved?.kind === "winston" ? "Turn" : "Booster"} {round}
                    </AppSelectOption>
                  ))}
                </AppSelect>
                <AppSelect
                  value={String(index)}
                  onValueChange={(value) => setIndex(Number(value))}
                  aria-label="Decision"
                >
                  {history.map(
                    (item, itemIndex) =>
                      item.round === decision.round && (
                        <AppSelectOption
                          key={`${item.revision}:${itemIndex}`}
                          value={String(itemIndex)}
                        >
                          {saved?.kind === "winston" ? item.action : "Pick"} {item.pickNumber}
                          {item.automatic ? " · automatic" : ""}
                        </AppSelectOption>
                      ),
                  )}
                </AppSelect>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={index === 0}
                  onClick={() => setIndex(index - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={index >= history.length - 1}
                  onClick={() => setIndex(index + 1)}
                >
                  Next
                </Button>
              </div>
              <p className="text-ui-body">
                {decision.action === "pass"
                  ? "Passed this Winston pile"
                  : decision.action === "take"
                    ? "Took this Winston pile"
                    : "Picked from this booster"}
                {decision.automatic ? " automatically" : ""}. Selected occurrences are highlighted.
              </p>
              <LimitedCardCanvas
                key={`${sessionId}:${decision.revision}`}
                cards={decision.visibleCards}
                selectedIds={decision.selectedIds}
                className="h-72"
                previewPortalTarget={previewPortalTarget}
                emptyMessage="No cards were visible before this action."
              />
              <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-1 text-ui-meta text-muted-foreground">
                {decision.visibleCards.map((card) => (
                  <li key={card.id}>
                    {decision.selectedIds.includes(card.id) ? "Picked · " : ""}
                    {card.name} · {card.setCode.toUpperCase()} #{card.cardNumber}
                    {card.foil ? " · Foil" : ""}
                  </li>
                ))}
              </ul>
              {unseenSelected.length > 0 && (
                <div className="grid gap-2">
                  <p className="text-ui-label font-medium">
                    Cards drawn after passing the final pile
                  </p>
                  <LimitedCardCanvas
                    cards={unseenSelected}
                    className="h-52"
                    previewPortalTarget={previewPortalTarget}
                  />
                </div>
              )}
            </section>
          ) : (
            saved && (
              <section className="grid gap-2">
                <p className="text-ui-body text-muted-foreground">
                  {saved.kind === "sealed"
                    ? "Your acquired Sealed pool"
                    : "No accepted decisions yet. Picks and Winston actions appear here after they are saved."}
                </p>
                <LimitedCardCanvas
                  cards={acquired}
                  className="h-72"
                  previewPortalTarget={previewPortalTarget}
                />
              </section>
            )
          )}
          {saved?.build && (
            <LimitedReviewBuilds
              key={sessionId}
              sessionId={saved.sourceSessionId ?? sessionId}
              build={saved.build}
              previewPortalTarget={previewPortalTarget}
              onOpenChange={onOpenChange}
            />
          )}
        </div>
        <DialogFooter className="shrink-0">
          <Button
            variant="outline"
            disabled={!saved || saved.kind === "gauntlet"}
            onClick={() => {
              if (!saved) return;
              try {
                exportLimitedReview(saved);
              } catch (cause) {
                setError(String(cause));
              }
            }}
          >
            Export review JSON
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
