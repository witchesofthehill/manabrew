import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Hourglass, MoreHorizontal, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LimitedModeSelector } from "@/components/limited/LimitedModeSelector";
import { LimitedSetupDialog } from "@/components/limited/LimitedSetupDialog";
import { LimitedSetupOptions } from "@/components/limited/LimitedSetupOptions";
import { LimitedSetConfiguration } from "@/components/limited/LimitedSetConfiguration";
import { LimitedCubeSource } from "@/components/limited/LimitedCubeSource";
import { LimitedReferenceButton } from "@/components/limited/LimitedReferenceButton";
import { useLimitedSetSelection } from "@/components/limited/useLimitedSetSelection";
import { useLimitedSetup } from "@/components/limited/useLimitedSetup";
import { LimitedSavedSessions } from "@/components/limited/LimitedSavedSessions";
import { limitedSessionRoute } from "@/game/limitedRecovery";
import { TablePickerDialog } from "@/components/lobby/TablePickerDialog";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import type { ReactNode } from "react";
import type { LimitedSetupPanel } from "@/components/limited/limitedSetup.types";

interface LimitedProps {
  leadingControl?: ReactNode;
}

export default function Limited({ leadingControl }: LimitedProps) {
  const navigate = useNavigate();
  const selection = useLimitedSetSelection();
  const setup = useLimitedSetup(selection.selectedCode, selection.selectedVariant);
  const background = usePreferencesStore((state) => state.boardBackgroundId);
  const setBackground = usePreferencesStore((state) => state.setBoardBackgroundId);
  const [panel, setPanel] = useState<LimitedSetupPanel | null>(null);
  const dialogTrigger = useRef<HTMLButtonElement | null>(null);
  const moreTrigger = useRef<HTMLButtonElement | null>(null);
  const openPanel = (next: LimitedSetupPanel, trigger: HTMLButtonElement | null) => {
    dialogTrigger.current = trigger;
    setPanel(next);
  };
  const modeTitle =
    setup.mode === "sealed" ? "Sealed" : setup.mode === "draft" ? "Booster Draft" : "Winston Draft";
  const startLabel = setup.fetchingPool
    ? "Fetching cards…"
    : setup.isStarting
      ? "Starting…"
      : `Start ${modeTitle}`;
  const parsedSeed = Number(setup.seed.trim());
  const summary = [
    setup.mode === "sealed"
      ? `${setup.numBoosters} packs`
      : setup.mode === "draft"
        ? `${setup.podSize} players · 3 packs each · ${setup.picksPerPass} ${setup.picksPerPass === 1 ? "pick" : "picks"} per pass`
        : `${setup.winstonPacks} packs per player · 2 players`,
    setup.source === "set" && selection.selectedVariant
      ? `${selection.selectedVariant} boosters`
      : null,
    setup.seed.trim() && Number.isFinite(parsedSeed) && parsedSeed >= 0
      ? `seed ${Math.floor(parsedSeed)}`
      : null,
    setup.mode === "draft" && setup.pickSeconds ? `${setup.pickSeconds}s per pick` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex h-full flex-col gap-8 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {leadingControl}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={moreTrigger}
              variant="ghost"
              size="icon"
              aria-label="More Limited options"
              disabled={setup.busy}
              className="ml-auto"
            >
              <MoreHorizontal className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(event) => {
              if (panel) event.preventDefault();
            }}
          >
            <DropdownMenuItem onSelect={() => openPanel("templates", moreTrigger.current)}>
              <Hourglass className="mr-2 h-4 w-4" />
              Sealed templates
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setup.setMode("draft");
                openPanel("chaos", moreTrigger.current);
              }}
            >
              <Shuffle className="mr-2 h-4 w-4" />
              Themed Chaos Draft
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <section aria-label={`${modeTitle} setup`} className="space-y-5">
        <LimitedModeSelector mode={setup.mode} onChange={setup.setMode} disabled={setup.busy} />
        <div className="rounded-lg border border-border/60 bg-card/40 p-4 sm:p-5">
          <LimitedSetupOptions
            mode={setup.mode}
            numBoosters={setup.numBoosters}
            onNumBoostersChange={setup.setNumBoosters}
            podSize={setup.podSize}
            onPodSizeChange={setup.setPodSize}
            winstonPacks={setup.winstonPacks}
            onWinstonPacksChange={setup.setWinstonPacks}
            seed={setup.seed}
            onSeedChange={setup.setSeed}
            picksPerPass={setup.picksPerPass}
            onPicksPerPassChange={setup.setPicksPerPass}
            pickSeconds={setup.pickSeconds}
            onPickSecondsChange={setup.setPickSeconds}
            variants={
              setup.source === "set" && !selection.loading ? (selection.info?.variants ?? []) : []
            }
            selectedVariant={selection.selectedVariant}
            onVariantChange={selection.onVariantChange}
            disabled={setup.busy}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-serif text-lg">Choose cards</h2>
          <AppSelect
            aria-label="Card source"
            value={setup.source}
            onValueChange={(value) => setup.setSource(value === "custom" ? "custom" : "set")}
            disabled={setup.busy}
            className="w-48"
          >
            <AppSelectOption value="set">Set boosters</AppSelectOption>
            <AppSelectOption value="custom">Cube / saved pool</AppSelectOption>
          </AppSelect>
        </div>
        {setup.source === "set" ? (
          <LimitedSetConfiguration
            sets={selection.sets}
            selectedCode={selection.selectedCode}
            prefetching={selection.prefetching}
            onSelect={selection.onSelect}
            info={selection.info}
            loading={selection.loading}
            selectedVariant={selection.selectedVariant}
            onViewCards={() =>
              navigate(`/search?set=${encodeURIComponent(selection.selectedCode)}`)
            }
            disabled={setup.busy}
          />
        ) : (
          <LimitedCubeSource
            input={setup.cubeInput}
            onInputChange={setup.setCubeInput}
            onImport={setup.onImport}
            onLoadFile={setup.onLoadFile}
            cube={setup.cube}
            busy={setup.busy}
          />
        )}
        <p className="text-sm leading-relaxed text-muted-foreground">{summary}</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <LimitedReferenceButton
            cards={[]}
            setCodes={setup.source === "set" ? [selection.selectedCode] : undefined}
            format={setup.source === "set" ? "set" : "cube"}
          />
          <Button variant="primary" onClick={setup.start} disabled={setup.startBlocked}>
            {startLabel}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
        {!panel && setup.lastError && (
          <p role="alert" className="text-sm text-destructive">
            {setup.lastError}
          </p>
        )}
      </section>
      <LimitedSavedSessions onResume={(saved) => navigate(limitedSessionRoute(saved))} />
      <LimitedSetupDialog
        panel={panel}
        onClose={() => setPanel(null)}
        triggerRef={dialogTrigger}
        setup={setup}
        sets={selection.sets}
        restoreFocus={!setup.pendingDraftStart}
      />
      <TablePickerDialog
        open={setup.pendingDraftStart !== null}
        background={background}
        onBackgroundChange={setBackground}
        onStart={setup.confirmDraftTable}
        onCancel={setup.cancelDraftTable}
        startLabel={
          setup.pendingDraftStart?.format === "Winston Draft" ? "Start Winston" : "Start Draft"
        }
        description="Choose the table for your draft."
        players={setup.draftSeats}
        maxPlayers={setup.pendingDraftStart?.seatCount ?? 2}
        centerContent={
          setup.pendingDraftStart && (
            <div className="space-y-1 rounded-md bg-card/80 px-3 py-2">
              <span className="font-serif text-lg font-light text-foreground/90">
                {setup.pendingDraftStart.format}
              </span>
              <p className="text-xs text-muted-foreground">
                You + {setup.pendingDraftStart.seatCount - 1} AI{" "}
                {setup.pendingDraftStart.seatCount === 2 ? "seat" : "seats"}
              </p>
            </div>
          )
        }
      />
    </div>
  );
}
