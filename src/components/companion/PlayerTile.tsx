import { useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useCompanionStore } from "@/stores/useCompanionStore";
import { COMPANION_ACCENT_COLORS } from "@/stores/useCompanionStore.constants";
import type { CompanionPlayer } from "@/stores/useCompanionStore.types";
import { AddCounterMenu } from "./AddCounterMenu";
import { CommanderArt } from "./CommanderArt";
import { CommanderDamageStrip } from "./CommanderDamageStrip";
import { CommanderPickerDialog } from "./CommanderPickerDialog";
import { CountersRail } from "./CountersRail";
import { ManaPoolRail } from "./ManaPoolRail";
import { GameIcon } from "./GameIcon";
import { PlayerMenu } from "./PlayerMenu";
import { StatusChips } from "./StatusChips";
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
  const setLife = useCompanionStore((s) => s.setLife);
  const renamePlayer = useCompanionStore((s) => s.renamePlayer);
  const pendingAmount = useCompanionStore((s) => s.pendingDeltas[player.id]?.amount ?? 0);
  const accent = COMPANION_ACCENT_COLORS[player.accentKey];

  const [renaming, setRenaming] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [lifeEditing, setLifeEditing] = useState(false);
  const [decTick, setDecTick] = useState(0);
  const [incTick, setIncTick] = useState(0);

  const decBindings = usePressHold({
    onTap: () => {
      adjustLife(player.id, -1);
      setDecTick((t) => t + 1);
    },
    onHoldTick: () => {
      adjustLife(player.id, -1);
      setDecTick((t) => t + 1);
    },
  });
  const incBindings = usePressHold({
    onTap: () => {
      adjustLife(player.id, 1);
      setIncTick((t) => t + 1);
    },
    onHoldTick: () => {
      adjustLife(player.id, 1);
      setIncTick((t) => t + 1);
    },
  });

  const isPerpendicular = Math.abs(rotation) === 90;
  const flashDec = externalLifeInput ? externalDecTick : decTick;
  const flashInc = externalLifeInput ? externalIncTick : incTick;
  const hasCommanderImage = Boolean(
    player.commanders[0]?.imageUrl || player.commanders[1]?.imageUrl,
  );
  // When commander art covers the tile, the accent-coloured background is
  // hidden — colour the active-turn ring with the accent instead of white
  // so it still identifies whose turn it is.
  // Active-turn outline + the baseline 1px hairline that the tile
  // normally gets via Tailwind's ring-1 ring-white/5. Inline box-shadow
  // overrides Tailwind's ring shadow, so we have to compose both here.
  const activeRing = isActive
    ? `0 0 0 ${hasCommanderImage ? 3 : 2}px ${hasCommanderImage ? accent : "white"}, 0 0 0 1px rgba(255,255,255,0.05)`
    : undefined;

  return (
    <div className={cn("relative size-full", className)} style={{ containerType: "size" }}>
      <div
        className={cn(
          "@container absolute overflow-hidden rounded-lg shadow-xl ring-1 ring-white/5 transition @md:rounded-2xl",
          player.isDead && "opacity-60 grayscale",
        )}
        style={{
          backgroundColor: accent,
          top: "50%",
          left: "50%",
          width: isPerpendicular ? "100cqh" : "100cqw",
          height: isPerpendicular ? "100cqw" : "100cqh",
          transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
          boxShadow: activeRing,
        }}
      >
        <CommanderArt refs={player.commanders} />

        {!externalLifeInput && (
          <>
            <button
              type="button"
              aria-label="Decrease life"
              className="absolute inset-y-0 left-0 z-10 w-1/2"
              {...decBindings}
            />
            <button
              type="button"
              aria-label="Increase life"
              className="absolute inset-y-0 right-0 z-10 w-1/2"
              {...incBindings}
            />
          </>
        )}
        <TapFlash decTick={flashDec} incTick={flashInc} />

        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col p-1.5 text-white @xs:p-2 @md:p-3">
          <div className="pointer-events-auto flex items-start gap-1.5 @md:gap-2">
            <button
              type="button"
              className="grid size-7 place-items-center overflow-hidden rounded-full bg-black/40 ring-1 ring-white/20 @xs:size-8 @md:size-10"
              onClick={() => setPickerOpen(true)}
              aria-label="Choose commander"
            >
              {player.commanders[0]?.imageUrl ? (
                <CommanderArt refs={player.commanders} variant="avatar" className="size-full" />
              ) : (
                <GameIcon icon="crossed-swords" className="size-3.5 text-white/70 @md:size-4" />
              )}
            </button>
            <div className="flex min-w-0 flex-1 flex-col">
              {renaming ? (
                <Input
                  autoFocus
                  defaultValue={player.name}
                  className="h-7 bg-black/30 text-sm text-white placeholder:text-white/50"
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name) renamePlayer(player.id, name);
                    setRenaming(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setRenaming(false);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="hidden self-start truncate text-left text-xs font-semibold tracking-wide drop-shadow @xs:block @md:text-sm"
                  onClick={() => setRenaming(true)}
                  title="Rename"
                >
                  {player.name}
                </button>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-1 @md:gap-1.5">
                <StatusChips player={player} />
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5 @md:gap-1">
              <AddCounterMenu player={player} />
              <PlayerMenu player={player} onPickCommander={() => setPickerOpen(true)} />
            </div>
          </div>

          <div className="relative flex flex-1 items-center justify-center">
            {pendingAmount !== 0 && (
              <div
                key={pendingAmount}
                className={cn(
                  "absolute -top-2 grid place-items-center rounded-full px-1.5 py-0.5 text-xs font-bold shadow @sm:px-2 @sm:text-base",
                  pendingAmount > 0 ? "bg-emerald-500/90" : "bg-rose-600/90",
                )}
              >
                {pendingAmount > 0 ? `+${pendingAmount}` : pendingAmount}
              </div>
            )}
            {lifeEditing ? (
              <input
                autoFocus
                type="number"
                defaultValue={player.life}
                className="pointer-events-auto w-20 rounded-md border border-white/30 bg-black/50 text-center text-3xl font-extrabold text-white outline-none @xs:w-24 @xs:text-4xl @sm:w-28 @sm:text-5xl"
                onBlur={(e) => {
                  const value = Number.parseInt(e.target.value, 10);
                  if (!Number.isNaN(value)) setLife(player.id, value);
                  setLifeEditing(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setLifeEditing(false);
                }}
              />
            ) : (
              <button
                type="button"
                className="pointer-events-auto select-none text-[clamp(2rem,22cqi,5.5rem)] font-black leading-none tabular-nums drop-shadow-md"
                onClick={() => setLifeEditing(true)}
                aria-label="Edit life total"
              >
                {player.life}
              </button>
            )}
          </div>

          <div className="pointer-events-auto flex flex-wrap items-end justify-between gap-1.5">
            <CountersRail playerId={player.id} counters={player.counters} />
            <ManaPoolRail playerId={player.id} pool={player.manaPool} />
          </div>
        </div>

        {opponents.length > 0 && (commanderRules || hasCommanderArt(opponents)) && (
          <div className="pointer-events-auto absolute right-1 top-1/2 z-30 -translate-y-1/2 @md:right-2">
            <CommanderDamageStrip target={player} opponents={opponents} />
          </div>
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
