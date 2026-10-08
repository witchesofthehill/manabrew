import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { LimitedCardCanvas } from "@/components/limited/LimitedCardCanvas";
import LimitedDeckBuilder from "@/components/limited/LimitedDeckBuilder";
import { useLimitedBuildStore } from "@/components/limited/useLimitedBuildStore";
import { useDraftPick, type DraftPickOptions } from "@/components/limited/useDraftPick";
import { useLimitedOpeningStore } from "@/components/limited/limitedOpeningStore";
import { useIsShortScreen, useIsTouch } from "@/hooks/useBreakpoints";
import { cn } from "@/lib/utils";
import { LimitedReferenceButton } from "@/components/limited/LimitedReferenceButton";
import { LimitedDraftFallback } from "@/components/limited/LimitedDraftFallback";
import type { LimitedReferenceFormat } from "@/components/limited/LimitedSetReference";
import type { ConspiracyHook } from "@/types/limited";

interface DraftWorkspaceProps extends DraftPickOptions {
  conspiracyHooks?: ConspiracyHook[];
  openingSetCode?: string;
  referenceFormat?: LimitedReferenceFormat;
  pickSeconds?: number;
}
export function DraftWorkspace({
  draft,
  onPick,
  pickPending = false,
  conspiracyHooks = [],
  openingSetCode,
  viewerSeat,
  referenceFormat,
  pickSeconds,
}: DraftWorkspaceProps) {
  const [mobileTab, setMobileTab] = useState<"pack" | "build">("pack");
  const {
    selected,
    submitting,
    disabled,
    workspaceRef,
    builderRef,
    pickTarget,
    select,
    submit,
    dropPick,
    clock,
    nominate,
  } = useDraftPick({ draft, onPick, pickPending, viewerSeat });
  const acquiredIds = useMemo(() => draft.pickedPile.map((card) => card.id), [draft.pickedPile]);
  const cardSize = useLimitedBuildStore(
    (state) => state.sessions[draft.sessionId]?.cardSize ?? state.displayPreferences.cardSize,
  );
  const referenceCards = useMemo(
    () => [...draft.currentPack, ...draft.pickedPile],
    [draft.currentPack, draft.pickedPile],
  );
  const roundKey = `${draft.sessionId}:round:${draft.round}`;
  const roundOpened = useLimitedOpeningStore((state) =>
    state.sessions[draft.sessionId]?.openedIds.includes(roundKey),
  );
  const timed = (pickSeconds ?? clock.clock?.pickSeconds ?? 0) > 0;
  const opening = draft.currentPack.length > 0 && !roundOpened && !timed;
  const activeTab = opening ? "pack" : mobileTab;
  const shortScreen = useIsShortScreen();
  const isTouch = useIsTouch();
  const shortTouch = shortScreen && isTouch;
  return (
    <div
      ref={workspaceRef}
      data-limited-table
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden"
    >
      <div
        role="tablist"
        aria-label="Draft workspace"
        className={cn("flex shrink-0 gap-1 lg:hidden", shortTouch && "lg:flex")}
      >
        <Button
          role="tab"
          aria-selected={activeTab === "pack"}
          variant={activeTab === "pack" ? "selected" : "ghost"}
          size="sm"
          onClick={() => setMobileTab("pack")}
        >
          Pack · {draft.currentPack.length}
        </Button>
        <Button
          role="tab"
          aria-selected={activeTab === "build"}
          variant={activeTab === "build" ? "selected" : "ghost"}
          size="sm"
          onClick={() => setMobileTab("build")}
        >
          Pool / build · {draft.pickedPile.length}
        </Button>
      </div>
      <div
        className={cn(
          "grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden lg:grid-rows-[minmax(0,min(42%,24rem))_minmax(0,1fr)]",
          shortTouch && "lg:grid-rows-1",
        )}
      >
        <section
          className={cn(
            "flex min-h-0 flex-col overflow-hidden",
            activeTab !== "pack" && "hidden lg:flex",
            shortTouch && activeTab !== "pack" && "lg:hidden",
          )}
          aria-label="Current booster"
        >
          <header className="flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-1 px-3">
            <h2 className="rounded bg-card/70 px-2 py-1 font-serif text-lg">
              Booster{" "}
              <span className="font-sans text-xs text-muted-foreground">
                {draft.currentPack.length}
              </span>
            </h2>
            <LimitedReferenceButton cards={referenceCards} format={referenceFormat} />
            {clock.clock && (
              <LimitedDraftFallback
                cards={draft.currentPack}
                nominatedId={clock.nominatedId}
                onNominate={nominate}
                disabled={disabled || !clock.seat}
              />
            )}
          </header>
          <LimitedCardCanvas
            cards={draft.currentPack}
            selectedIds={selected ? [selected.id] : []}
            onSelect={select}
            onActivate={(card) => void submit(card)}
            onDrop={dropPick}
            disabled={disabled}
            cardSize={cardSize}
            presentation="spread"
            arrivalDirection={draft.passDirection === "left" ? "right" : "left"}
            acquiredIds={acquiredIds}
            departureTarget={pickTarget}
            arrivalKey={`${draft.sessionId}:${draft.round}:${draft.pickNumber}`}
            opening={opening}
            openingSetCode={openingSetCode}
            onOpeningComplete={() => {
              setMobileTab("pack");
              useLimitedOpeningStore.getState().open(draft.sessionId, [roundKey]);
            }}
            emptyMessage={
              draft.isComplete
                ? "Draft complete. Finish your build."
                : "Waiting for the next booster..."
            }
            className="min-h-0 flex-1"
          />
          <footer className="flex shrink-0 flex-wrap items-center justify-center gap-2 px-3 py-1">
            <Button
              data-limited-zone="pool"
              variant="primary"
              size="sm"
              disabled={!selected || disabled}
              className="shrink-0 data-[limited-drop-active=true]:ring-2 data-[limited-drop-active=true]:ring-card-ring"
              onClick={() => {
                if (selected) void submit(selected);
              }}
            >
              {pickPending || submitting ? "Picking..." : "Pick to Pool"}
            </Button>
            <Button
              data-limited-zone="main"
              variant="secondary"
              size="sm"
              disabled={!selected || disabled}
              className="shrink-0 data-[limited-drop-active=true]:ring-2 data-[limited-drop-active=true]:ring-card-ring"
              onClick={() => {
                if (selected) void submit(selected, "main");
              }}
            >
              Pick to Mainboard
            </Button>
          </footer>
        </section>
        <section
          ref={builderRef}
          className={cn(
            "flex min-h-0 min-w-0 flex-col gap-2",
            activeTab !== "build" && "hidden lg:flex",
            shortTouch && activeTab !== "build" && "lg:hidden",
          )}
          aria-label="Your acquired pool and deck"
        >
          {!!draft.humanConspiracies?.length && (
            <details className="mx-2 min-w-0 max-w-xl shrink-0 text-xs">
              <summary className="cursor-pointer rounded bg-card/70 px-2 py-1 font-semibold">
                Conspiracies · {draft.humanConspiracies.length}
              </summary>
              <ul className="max-h-24 space-y-1 overflow-y-auto rounded bg-card/90 p-2">
                {draft.humanConspiracies.map((name) => (
                  <li key={name}>
                    <span className="font-medium">{name}</span>
                    {conspiracyHooks.find((hook) => hook.cardName === name)?.description && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {conspiracyHooks.find((hook) => hook.cardName === name)?.description}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="min-h-0 flex-1">
            <LimitedDeckBuilder
              key={draft.sessionId}
              sessionKey={draft.sessionId}
              pool={draft.pickedPile}
              defaultDeckName="Booster Draft Deck"
              format="draft"
              showUtilities={false}
              referenceFormat={referenceFormat}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
