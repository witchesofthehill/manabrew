import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DraftPodButton } from "@/components/limited/DraftPodButton";
import { LimitedModeToggle, type LimitedDraftMode } from "@/components/limited/LimitedModeToggle";
import type { DraftState } from "@/types/limited";

interface DraftStatusBarProps {
  draft: DraftState;
  mode?: LimitedDraftMode;
  onModeChange?: (mode: LimitedDraftMode) => void;
  onUndo?: () => void;
  canBuild?: boolean;
  seatLabel?: string;
  isHost?: boolean;
  waitingLabel?: string;
  viewerSeat?: number;
}

export function DraftStatusBar({
  draft,
  mode,
  onModeChange,
  onUndo,
  canBuild = false,
  seatLabel,
  isHost = false,
  waitingLabel = "AI thinking…",
  viewerSeat = 0,
}: DraftStatusBarProps) {
  const PassIcon = draft.passDirection === "right" ? ArrowRight : ArrowLeft;
  const packsWaiting =
    draft.seatSummaries.find((seat) => seat.seat === viewerSeat)?.packsWaiting ?? 0;

  return (
    <header className="z-10 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 bg-background/95 px-3 py-2 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">
          Round {draft.round}/{draft.totalRounds} · Pick {draft.pickNumber}
        </span>
        <span className="inline-flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 text-[11px]">
          <PassIcon className="h-3 w-3" /> Pass {draft.passDirection ?? "left"}
        </span>
        <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[11px]">
          {draft.currentPack.length} in pack
        </span>
        {packsWaiting > 0 && (
          <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[11px]">
            {packsWaiting} waiting
          </span>
        )}
        {seatLabel && (
          <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[11px]">{seatLabel}</span>
        )}
        {isHost && (
          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
            Host
          </span>
        )}
        {draft.isComplete ? (
          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
            Draft complete
          </span>
        ) : draft.awaitingHuman ? (
          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
            {draft.picksPerPass > 1 && draft.picksRemainingInPack > 0
              ? `Your pick · ${draft.picksRemainingInPack} remaining`
              : "Your pick"}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded bg-muted/60 px-1.5 py-0.5 text-[11px] font-medium">
            <Loader2 className="h-3 w-3 animate-spin" />
            {waitingLabel}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <DraftPodButton seats={draft.seatSummaries} />
        {canBuild && onUndo && (
          <Button size="sm" variant="ghost" onClick={onUndo} className="h-8 px-2 text-xs">
            Undo pick
          </Button>
        )}
        {canBuild && mode && onModeChange && (
          <LimitedModeToggle
            mode={mode}
            onChange={onModeChange}
            disableDrafting={draft.isComplete}
          />
        )}
      </div>
    </header>
  );
}
