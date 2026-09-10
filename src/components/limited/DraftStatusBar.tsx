import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DraftPodButton } from "@/components/limited/DraftPodButton";
import { LimitedModeToggle, type LimitedDraftMode } from "@/components/limited/LimitedModeToggle";
import type { DraftState } from "@/types/limited";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
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
          <Trans>
            Round {draft.round}/{draft.totalRounds} · Pick {draft.pickNumber}
          </Trans>
        </span>
        <span className="inline-flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 text-[11px]">
          <Trans>
            <PassIcon className="h-3 w-3" /> Pass {draft.passDirection ?? "left"}
          </Trans>
        </span>
        <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[11px]">
          <Trans>{draft.currentPack.length} in pack</Trans>
        </span>
        {packsWaiting > 0 && (
          <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[11px]">
            <Trans>{packsWaiting} waiting</Trans>
          </span>
        )}
        {seatLabel && (
          <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[11px]">{seatLabel}</span>
        )}
        {isHost && (
          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
            <Trans>Host</Trans>
          </span>
        )}
        {draft.isComplete ? (
          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
            <Trans>Draft complete</Trans>
          </span>
        ) : draft.awaitingHuman ? (
          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
            {draft.picksPerPass > 1 && draft.picksRemainingInPack > 0
              ? i18n._(msg`Your pick · ${draft.picksRemainingInPack} remaining`)
              : i18n._(msg`Your pick`)}
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
            <Trans>Undo pick</Trans>
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
