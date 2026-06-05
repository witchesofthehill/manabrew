import { ArrowRight } from "lucide-react";
import { GameIcon } from "./GameIcon";
import { CommanderArt } from "./CommanderArt";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCompanionStore } from "@/stores/useCompanionStore";
import {
  COMPANION_ACCENT_COLORS,
  COMPANION_LETHAL_COMMANDER_DAMAGE,
} from "@/stores/useCompanionStore.constants";
import type { CompanionPlayer } from "@/stores/useCompanionStore.types";
import { usePressHold } from "./usePressHold";

interface CommanderDamageDialogProps {
  target: CompanionPlayer;
  source: CompanionPlayer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommanderDamageDialog({
  target,
  source,
  open,
  onOpenChange,
}: CommanderDamageDialogProps) {
  const sourceAccent = COMPANION_ACCENT_COLORS[source.accentKey];
  const targetAccent = COMPANION_ACCENT_COLORS[target.accentKey];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GameIcon icon="crossed-swords" className="size-5" /> Commander damage
          </DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-center gap-2.5 text-sm">
          <span className="flex items-center gap-1.5 font-semibold">
            <span className="size-3 rounded-full" style={{ backgroundColor: sourceAccent }} />
            {source.name}
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="flex items-center gap-1.5 font-semibold">
            <span className="size-3 rounded-full" style={{ backgroundColor: targetAccent }} />
            {target.name}
          </span>
        </div>
        {open && (
          <div className="flex flex-col gap-2.5">
            <DamageStepper target={target} source={source} slot={0} accent={sourceAccent} />
            {source.commanders[1] && (
              <DamageStepper target={target} source={source} slot={1} accent={sourceAccent} />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DamageStepper({
  target,
  source,
  slot,
  accent,
}: {
  target: CompanionPlayer;
  source: CompanionPlayer;
  slot: 0 | 1;
  accent: string;
}) {
  const adjust = useCompanionStore((s) => s.adjustCommanderDamage);
  const damage = (target.commanderDamage[source.id] ?? [0, 0])[slot];
  const commander = source.commanders[slot];
  const label = commander?.name ?? (slot === 0 ? "Commander" : "Partner");
  const lethal = damage >= COMPANION_LETHAL_COMMANDER_DAMAGE;

  const dec = usePressHold({
    onTap: () => adjust(target.id, source.id, slot, -1),
    onHoldTick: () => adjust(target.id, source.id, slot, -1),
  });
  const inc = usePressHold({
    onTap: () => adjust(target.id, source.id, slot, 1),
    onHoldTick: () => adjust(target.id, source.id, slot, 1),
  });

  return (
    <div className="rounded-xl border border-border bg-card/40 p-3">
      <div className="mb-2.5 flex items-center gap-2">
        <div
          className="size-8 shrink-0 overflow-hidden rounded-full ring-1 ring-white/15"
          style={{ backgroundColor: accent }}
        >
          <CommanderArt refs={[commander ?? null, null]} variant="avatar" className="size-full" />
        </div>
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={label}>
          {label}
        </span>
        {lethal && (
          <span className="rounded-full bg-destructive px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-destructive-foreground">
            Lethal
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="grid size-14 touch-none select-none place-items-center rounded-full bg-muted text-3xl font-light text-foreground transition active:scale-95 active:bg-muted/70"
          aria-label="Decrease commander damage"
          {...dec}
        >
          −
        </button>
        <span
          className={cn(
            "min-w-[3rem] text-center text-5xl font-black tabular-nums",
            lethal && "text-destructive",
          )}
        >
          {damage}
        </span>
        <button
          type="button"
          className="grid size-14 touch-none select-none place-items-center rounded-full bg-muted text-3xl font-light text-foreground transition active:scale-95 active:bg-muted/70"
          aria-label="Increase commander damage"
          {...inc}
        >
          +
        </button>
      </div>
    </div>
  );
}
