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
      : `Start ${setup.mode === "draft" ? "Draft" : setup.mode === "winston" ? "Winston" : "Sealed"}`;
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
  const selectedSet = selection.sets.find((set) => set.code === selection.selectedCode);
  const sourceTitle =
    setup.source === "set"
      ? (selectedSet?.name ?? "Choose a set")
      : (setup.cube?.name ?? "Choose a cube or pool");
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden px-4 pt-4 text-ui-body sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:grid-rows-[auto_minmax(0,1fr)_auto] lg:gap-x-8 lg:px-8">
      <div className="-mx-1 min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-1 lg:contents">
        <header className="mb-5 lg:col-span-2">
          <LimitedModeSelector
            mode={setup.mode}
            onChange={setup.setMode}
            disabled={setup.busy}
            leadingControl={leadingControl}
            actions={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    ref={moreTrigger}
                    variant="ghost"
                    size="icon"
                    aria-label="More Limited options"
                    disabled={setup.busy}
                    className="ml-auto touch:min-h-11 touch:min-w-11"
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
            }
          />
        </header>
        <section
          aria-label={`${modeTitle} cards`}
          className="min-w-0 space-y-4 pb-5 lg:-ml-1 lg:col-start-1 lg:row-span-2 lg:row-start-2 lg:min-h-0 lg:overflow-y-auto lg:pl-1 lg:pr-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-serif text-lg font-semibold">Choose cards</h2>
            <AppSelect
              aria-label="Card source"
              value={setup.source}
              onValueChange={(value) => setup.setSource(value === "custom" ? "custom" : "set")}
              disabled={setup.busy}
              className="w-48 max-w-full"
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
          <LimitedReferenceButton
            cards={[]}
            setCodes={setup.source === "set" ? [selection.selectedCode] : undefined}
            format={setup.source === "set" ? "set" : "cube"}
          />
          <LimitedSavedSessions
            disabled={setup.busy || setup.pendingDraftStart !== null}
            onResume={setup.resume}
          />
        </section>
        <section
          aria-label={`${modeTitle} options`}
          className="min-w-0 border-t border-border/60 py-4 lg:-mx-1 lg:col-start-2 lg:row-start-2 lg:min-h-0 lg:overflow-y-auto lg:border-t-0 lg:px-1 lg:py-0 lg:pb-4"
        >
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
        </section>
      </div>
      <footer className="-mx-1 max-h-[45%] shrink-0 overflow-y-auto overscroll-contain border-t border-border/60 bg-background px-1 pt-3 pb-[max(0.75rem,var(--safe-area-inset-bottom))] lg:col-start-2 lg:row-start-3 lg:max-h-[40dvh]">
        <div className="flex flex-wrap items-center gap-3 lg:flex-col lg:items-stretch">
          <div className="min-w-0 basis-48 flex-1 lg:basis-auto" aria-live="polite">
            <p className="text-ui-body font-semibold break-words text-foreground">{sourceTitle}</p>
            <p className="text-ui-meta leading-relaxed break-words text-muted-foreground">
              {summary}
            </p>
          </div>
          <Button
            variant="primary"
            onClick={setup.start}
            disabled={setup.startBlocked}
            className="min-h-11 max-w-full shrink-0 whitespace-normal touch:min-w-11"
          >
            {startLabel}
            <ArrowRight aria-hidden="true" className="ml-2 h-4 w-4" />
          </Button>
        </div>
        {!panel && setup.lastError && (
          <p role="alert" className="mt-2 text-ui-label break-words text-destructive">
            {setup.lastError}
          </p>
        )}
      </footer>
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
              <span className="font-serif text-lg font-semibold text-foreground/90">
                {setup.pendingDraftStart.format}
              </span>
              <p className="text-ui-meta text-muted-foreground">
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
