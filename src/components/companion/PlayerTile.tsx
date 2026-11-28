import { useRef, useState } from "react";
import { ChevronRight, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useCompanionStore } from "@/stores/useCompanionStore";
import { COMPANION_ACCENT_COLORS } from "@/stores/useCompanionStore.constants";
import type { CompanionPlayer } from "@/stores/useCompanionStore.types";
import { CommanderArt } from "./CommanderArt";
import { CommanderPickerDialog } from "./CommanderPickerDialog";
import { GameIcon } from "./GameIcon";
import { PlayerMenu } from "./PlayerMenu";
import { PlayerResources } from "./PlayerResources";
import { TapFlash } from "./TapFlash";
import { usePressHold } from "./usePressHold";
interface PlayerTileProps {
  player: CompanionPlayer;
  opponents: CompanionPlayer[];
  rotation: number;
  commanderRules: boolean;
  isActive: boolean;
  className?: string;
  /** Free-layout owner handles pointer events itself, so PlayerTile suppresses
   *  its own tap zones and press-hold to avoid clashing with body-drag. */
  externalLifeInput?: boolean;
  /** Counter bumps from the external owner that drive the side-flash animation
   *  when `externalLifeInput` is on. */
  externalDecTick?: number;
  externalIncTick?: number;
}
export function PlayerTile({
  player,
  opponents,
  rotation,
  commanderRules,
  isActive,
  className,
  externalLifeInput = false,
  externalDecTick = 0,
  externalIncTick = 0,
}: PlayerTileProps) {
  const adjustLife = useCompanionStore((s) => s.adjustLife);
  const renamePlayer = useCompanionStore((s) => s.renamePlayer);
  const pendingAmount = useCompanionStore((s) => s.pendingDeltas[player.id]?.amount ?? 0);
  const accent = COMPANION_ACCENT_COLORS[player.accentKey];
  const [renaming, setRenaming] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [returnToolsFocus, setReturnToolsFocus] = useState<(() => void) | null>(null);
  const resourcesTrigger = useRef<HTMLButtonElement>(null);
  const [decTick, setDecTick] = useState(0);
  const [incTick, setIncTick] = useState(0);
  const bumpLife = (delta: -1 | 1) => {
    adjustLife(player.id, delta);
    if (delta < 0) setDecTick((t) => t + 1);
    else setIncTick((t) => t + 1);
  };
  const decBindings = usePressHold({
    onTap: () => bumpLife(-1),
    onHoldTick: () => bumpLife(-1),
    maxMotion: 8,
  });
  const incBindings = usePressHold({
    onTap: () => bumpLife(1),
    onHoldTick: () => bumpLife(1),
    maxMotion: 8,
  });
  const isPerpendicular = Math.abs(rotation) === 90;
  const flashDec = externalLifeInput ? externalDecTick : decTick;
  const flashInc = externalLifeInput ? externalIncTick : incTick;
  const hasCommanderImage = Boolean(
    player.commanders[0]?.imageUrl || player.commanders[1]?.imageUrl,
  );
  const showDamage = opponents.length > 0 && (commanderRules || hasCommanderArt(opponents));
  const highestDamage = showDamage
    ? opponents.reduce((highest, source) => {
        const pair = player.commanderDamage[source.id];
        return pair ? Math.max(highest, ...pair) : highest;
      }, 0)
    : 0;
  const lifeZoneClass = "grid min-h-11 min-w-0 place-items-center text-2xl font-semibold";
  const activeRing = isActive
    ? `0 0 0 2px var(--foreground), 0 0 0 4px ${accent}`
    : `0 0 0 1px ${accent}`;
  return (
    <div className={cn("relative size-full", className)} style={{ containerType: "size" }}>
      <div
        className={cn(
          "companion-seat absolute overflow-hidden rounded-lg border border-border shadow-sm @md:rounded-xl",
          player.isDead && "opacity-60 grayscale",
        )}
        style={{
          backgroundColor: `color-mix(in oklab, ${accent} 18%, var(--card))`,
          top: "50%",
          left: "50%",
          width: isPerpendicular ? "100cqh" : "100cqw",
          height: isPerpendicular ? "100cqw" : "100cqh",
          transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
          boxShadow: activeRing,
        }}
      >
        <CommanderArt refs={player.commanders} />
        {externalLifeInput && <div className="absolute inset-0 touch-none" aria-hidden />}

        {hasCommanderImage && (
          <div className="pointer-events-none absolute inset-0 bg-background/80" />
        )}
        <TapFlash decTick={flashDec} incTick={flashInc} />

        <div className="pointer-events-none absolute inset-0 z-20 overflow-y-auto overscroll-contain">
          <div
            className={cn(
              "flex min-h-full flex-col gap-1.5 p-2 text-foreground @md:p-3",
              externalLifeInput && "pb-14 @md:pb-14 @max-[9rem]:pb-28",
            )}
          >
            <div
              data-companion-no-body-drag
              className="pointer-events-auto flex shrink-0 items-center gap-1.5"
            >
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="hidden overflow-hidden rounded-full @min-[12rem]:inline-flex touch:min-h-11 touch:min-w-11"
                onClick={() => setPickerOpen(true)}
                aria-label="Choose commander"
              >
                {player.commanders[0]?.imageUrl ? (
                  <CommanderArt refs={player.commanders} variant="avatar" className="size-full" />
                ) : (
                  <GameIcon icon="crossed-swords" className="size-4" />
                )}
              </Button>
              {renaming ? (
                <Input
                  autoFocus
                  defaultValue={player.name}
                  className="min-w-0 flex-1"
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name) renamePlayer(player.id, name);
                    setRenaming(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setRenaming(false);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="min-h-8 min-w-0 flex-1 truncate rounded px-1 text-left text-ui-label font-semibold hover:underline focus-visible:ring-2 focus-visible:ring-ring touch:min-h-11"
                  onClick={() => setRenaming(true)}
                  aria-label={`Rename ${player.name}`}
                  title={player.name}
                >
                  {player.name}
                </button>
              )}
              <PlayerMenu
                player={player}
                onPickCommander={() => setPickerOpen(true)}
                onOpenTools={(returnFocus) => setReturnToolsFocus(() => returnFocus)}
              />
            </div>

            <div className="relative grid min-h-11 flex-1 shrink-0 grid-cols-[minmax(2.75rem,1fr)_minmax(0,auto)_minmax(2.75rem,1fr)] items-stretch gap-1 text-foreground">
              {externalLifeInput ? (
                <span aria-hidden className={lifeZoneClass}>
                  −
                </span>
              ) : (
                <button
                  type="button"
                  aria-label={`Decrease ${player.name}'s life`}
                  className={cn(
                    lifeZoneClass,
                    "pointer-events-auto touch-none rounded-md hover:bg-background/50 focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                  {...decBindings}
                >
                  −
                </button>
              )}
              <div
                data-companion-life-readout
                className="pointer-events-auto grid min-w-0 touch-none place-items-center"
              >
                <span className="max-w-full select-none break-all px-2 text-center text-[clamp(1.5rem,min(18cqi,26cqb),8rem)] leading-none font-black tabular-nums">
                  <span className="sr-only">{player.name} has </span>
                  {player.life}
                  <span className="sr-only"> life</span>
                </span>
              </div>
              {externalLifeInput ? (
                <span aria-hidden className={lifeZoneClass}>
                  +
                </span>
              ) : (
                <button
                  type="button"
                  aria-label={`Increase ${player.name}'s life`}
                  className={cn(
                    lifeZoneClass,
                    "pointer-events-auto touch-none rounded-md hover:bg-background/50 focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                  {...incBindings}
                >
                  +
                </button>
              )}
              {pendingAmount !== 0 && (
                <span className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 rounded-full bg-background px-2 text-ui-meta font-bold tabular-nums">
                  {pendingAmount > 0 ? `+${pendingAmount}` : pendingAmount}
                </span>
              )}
            </div>

            <Button
              ref={resourcesTrigger}
              type="button"
              variant="ghost"
              aria-haspopup="dialog"
              className="companion-seat-summary pointer-events-auto min-w-0 shrink-0 justify-start px-2 touch:min-h-11"
              onClick={() =>
                setReturnToolsFocus(
                  () => () => resourcesTrigger.current?.focus({ preventScroll: true }),
                )
              }
            >
              <SlidersHorizontal aria-hidden />
              <span className="sr-only">Open player tools: </span>
              <span className="min-w-0 flex-1 truncate text-left">
                {player.counters.length > 0
                  ? player.counters
                      .map((counter) => `${counter.label} ${counter.value}`)
                      .join(" · ")
                  : "Player tools"}
              </span>
              {highestDamage > 0 && (
                <span
                  className="shrink-0 tabular-nums"
                  title="Highest damage from a single commander"
                >
                  <GameIcon icon="crossed-swords" className="mr-1 inline size-3" />
                  {highestDamage}
                </span>
              )}
              <ChevronRight aria-hidden />
            </Button>
            <PlayerResources
              className="companion-seat-controls max-h-20 shrink-0 overflow-y-auto overscroll-contain"
              player={player}
              opponents={opponents}
              commanderRules={commanderRules}
              showDamage={showDamage}
            />
          </div>
        </div>
        {returnToolsFocus && (
          <Dialog open onOpenChange={(open) => !open && setReturnToolsFocus(null)}>
            <DialogContent
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                returnToolsFocus();
              }}
            >
              <DialogHeader>
                <DialogTitle>Player tools</DialogTitle>
                <DialogDescription className="break-words">{player.name}</DialogDescription>
              </DialogHeader>
              <PlayerResources
                player={player}
                opponents={opponents}
                commanderRules={commanderRules}
                showDamage={showDamage}
              />
            </DialogContent>
          </Dialog>
        )}

        <CommanderPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          playerId={player.id}
          initial={player.commanders}
        />
      </div>
    </div>
  );
}
function hasCommanderArt(players: CompanionPlayer[]): boolean {
  return players.some((p) => p.commanders[0]?.imageUrl);
}
